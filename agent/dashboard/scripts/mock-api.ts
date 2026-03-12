/**
 * Vite plugin that serves mock API responses from fixture JSONL files.
 * Used in `npm run dev:mock` — no running container needed.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";

const FIXTURES_DIR = join(import.meta.dirname, "..", ".fixtures", "sessions");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface JLine {
  type: string;
  timestamp?: string;
  message?: {
    role?: string;
    model?: string;
    content?: JContentBlock[];
    stop_reason?: string | null;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
}

interface JContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string | JContentBlock[];
}

function parseLines(raw: string): JLine[] {
  return raw.split("\n").filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean) as JLine[];
}

function isRealUser(line: JLine): boolean {
  if (line.type !== "user") return false;
  const c = line.message?.content;
  return Array.isArray(c) && c.length > 0 && c[0]?.type === "text";
}

function isToolResult(line: JLine): boolean {
  if (line.type !== "user") return false;
  const c = line.message?.content;
  return Array.isArray(c) && c.some((b) => b.type === "tool_result");
}

function extractText(content: JContentBlock[]): string {
  return content.filter((b) => b.type === "text" && b.text).map((b) => b.text!).join("\n");
}

function extractToolResultText(content: JContentBlock[]): string {
  for (const block of content) {
    if (block.type === "tool_result") {
      if (typeof block.content === "string") return block.content;
      if (Array.isArray(block.content)) {
        return block.content.filter((b) => typeof b === "object" && b.type === "text" && b.text).map((b) => (b as JContentBlock).text!).join("\n");
      }
    }
  }
  return "";
}

const SKIP = new Set(["queue-operation", "last-prompt", "file-history-snapshot", "progress", "system"]);

function buildSummary(id: string, lines: JLine[]) {
  let title = "";
  let timestamp = "";
  let lastActivity = "";
  let model = "";
  let messageCount = 0;

  for (const line of lines) {
    if (SKIP.has(line.type)) continue;
    if (line.timestamp) {
      if (!timestamp) timestamp = line.timestamp;
      lastActivity = line.timestamp;
    }
    if (!title && isRealUser(line)) {
      title = extractText(line.message!.content!).slice(0, 100);
    }
    if (isRealUser(line)) messageCount++;
    if (line.type === "assistant" && line.message?.stop_reason === "end_turn") {
      messageCount++;
      if (!model && line.message.model) model = line.message.model;
    }
  }

  if (!title && !timestamp) return null;
  return { id, title: title || "(no prompt)", timestamp, lastActivity, model: model || "unknown", messageCount, costUsd: 0, hasPty: false };
}

function buildConversation(id: string, lines: JLine[]) {
  const messages: unknown[] = [];
  let model = "";

  for (const line of lines) {
    if (SKIP.has(line.type)) continue;
    const content = line.message?.content;
    if (!Array.isArray(content)) continue;

    if (isRealUser(line)) {
      messages.push({ role: "user", content: extractText(content), timestamp: line.timestamp ?? "" });
      continue;
    }

    if (isToolResult(line)) {
      const resultText = extractToolResultText(content);
      const toolUseId = content.find((b) => b.type === "tool_result")?.tool_use_id;
      if (toolUseId) {
        messages.push({ role: "tool_result", content: resultText.slice(0, 5000), timestamp: line.timestamp ?? "", toolUseId });
      }
      continue;
    }

    if (line.type === "assistant") {
      if (line.message?.stop_reason === null || line.message?.stop_reason === undefined) continue;
      if (!model && line.message?.model) model = line.message.model;

      let textContent = "";
      let thinkingContent = "";
      for (const block of content) {
        if (block.type === "text" && block.text) textContent += block.text;
        else if (block.type === "thinking" && block.thinking) thinkingContent += block.thinking;
        else if (block.type === "tool_use") {
          messages.push({ role: "tool_use", content: "", timestamp: line.timestamp ?? "", toolName: block.name, toolInput: block.input, toolUseId: block.id, model: line.message?.model });
        }
      }

      if (textContent) {
        messages.push({
          role: "assistant", content: textContent, timestamp: line.timestamp ?? "", model: line.message?.model,
          thinkingContent: thinkingContent || undefined,
          tokensIn: line.message?.usage?.input_tokens,
          tokensOut: line.message?.usage?.output_tokens,
        });
      }
    }
  }

  return { id, messages, totalCostUsd: 0, model: model || "unknown" };
}

/** Load all fixture sessions */
function loadFixtures(): Map<string, JLine[]> {
  const sessions = new Map<string, JLine[]>();
  try {
    for (const file of readdirSync(FIXTURES_DIR)) {
      if (!file.endsWith(".jsonl")) continue;
      const id = file.replace(".jsonl", "");
      if (!UUID_RE.test(id)) continue;
      const raw = readFileSync(join(FIXTURES_DIR, file), "utf-8");
      sessions.set(id, parseLines(raw));
    }
  } catch {
    console.warn("[mock-api] No fixtures found. Run: npx tsx scripts/generate-fixtures.ts");
  }
  return sessions;
}

export function mockApiPlugin(): Plugin {
  let sessions: Map<string, JLine[]>;

  return {
    name: "mock-api",
    configureServer(server) {
      sessions = loadFixtures();
      console.log(`[mock-api] Loaded ${sessions.size} fixture sessions`);

      // GET /api/sessions
      server.middlewares.use("/api/sessions", (req, res, next) => {
        if (req.method !== "GET") return next();

        // /api/sessions/:id
        const match = req.url?.match(/^\/([0-9a-f-]{36})$/);
        if (match) {
          const id = match[1];
          const lines = sessions.get(id);
          if (!lines) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Not found" }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(buildConversation(id, lines)));
          return;
        }

        // /api/sessions
        const summaries = [];
        for (const [id, lines] of sessions) {
          const s = buildSummary(id, lines);
          if (s) summaries.push(s);
        }
        summaries.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(summaries));
      });

      // GET /api/status
      server.middlewares.use("/api/status", (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ name: "mock-bot", state: "idle", model: "claude-sonnet-4", uptime: 3600, current_task: null, talking_to: null, last_active: new Date().toISOString() }));
      });

      // GET /api/config
      server.middlewares.use("/api/config", (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ name: "mock-bot", model: "sonnet", max_turns: 25, permission_mode: "default", schedule: 0 }));
      });

      // GET /api/schedule
      server.middlewares.use("/api/schedule", (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify([]));
      });

      // GET /api/costs
      server.middlewares.use("/api/costs", (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ today: 0.42, week: 2.18, month: 8.95, total: 15.60 }));
      });

      // GET /api/logs
      server.middlewares.use("/api/logs", (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify([]));
      });

      // GET /health
      server.middlewares.use("/health", (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", name: "mock-bot" }));
      });
    },
  };
}
