import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import type { PtyManager } from "./pty-manager.js";

// --- Types ---

export interface SessionSummary {
  id: string;
  title: string;
  timestamp: string;
  lastActivity: string;
  model: string;
  messageCount: number;
  costUsd: number;
  hasPty: boolean;
}

export interface ConversationMessage {
  role: "user" | "assistant" | "tool_use" | "tool_result";
  content: string;
  timestamp: string;
  toolName?: string;
  toolInput?: unknown;
  toolUseId?: string;
  toolResultContent?: string;
  model?: string;
  thinkingContent?: string;
  tokensIn?: number;
  tokensOut?: number;
}

export interface SessionDetail {
  id: string;
  messages: ConversationMessage[];
  totalCostUsd: number;
  model: string;
}

// --- JSONL line types ---

interface JLine {
  type: string;
  timestamp?: string;
  sessionId?: string;
  message?: {
    role?: string;
    model?: string;
    content?: JContentBlock[];
    stop_reason?: string | null;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  toolUseResult?: unknown;
  tool_use_id?: string;
  sourceToolAssistantUUID?: string;
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

// --- Helpers ---

function normalizeCwd(cwd: string): string {
  return cwd.replace(/\//g, "-");
}

const SKIP_TYPES = new Set(["queue-operation", "last-prompt", "file-history-snapshot", "progress", "system"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isToolResultLine(line: JLine): boolean {
  if (line.type !== "user") return false;
  const content = line.message?.content;
  if (!Array.isArray(content) || content.length === 0) return false;
  return content.some((b) => b.type === "tool_result");
}

function isRealUserMessage(line: JLine): boolean {
  if (line.type !== "user") return false;
  const content = line.message?.content;
  if (!Array.isArray(content) || content.length === 0) return false;
  return content[0]?.type === "text";
}

function extractTextFromContent(content: JContentBlock[]): string {
  return content
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text!)
    .join("\n");
}

function extractToolResultText(content: JContentBlock[]): string {
  for (const block of content) {
    if (block.type === "tool_result") {
      if (typeof block.content === "string") return block.content;
      if (Array.isArray(block.content)) {
        return block.content
          .filter((b) => typeof b === "object" && b.type === "text" && b.text)
          .map((b) => (b as JContentBlock).text!)
          .join("\n");
      }
    }
  }
  return "";
}

function parseLines(raw: string): JLine[] {
  const lines: JLine[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      lines.push(JSON.parse(line));
    } catch {
      // skip malformed lines
    }
  }
  return lines;
}

// --- Main class ---

export class SessionHistory {
  private projectDir: string;
  private ptyManager?: PtyManager;
  private listCache: { summaries: SessionSummary[]; mtimes: Map<string, number>; cachedAt: number } | null = null;
  private static LIST_CACHE_TTL_MS = 5_000;

  constructor(workspaceCwd: string, ptyManager?: PtyManager) {
    const normalized = normalizeCwd(workspaceCwd);
    this.projectDir = join(homedir(), ".claude", "projects", normalized);
    this.ptyManager = ptyManager;
  }

  async list(): Promise<SessionSummary[]> {
    if (!existsSync(this.projectDir)) return [];

    // Return cached result if fresh enough
    if (this.listCache && Date.now() - this.listCache.cachedAt < SessionHistory.LIST_CACHE_TTL_MS) {
      return this.listCache.summaries;
    }

    const files = await readdir(this.projectDir);
    const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));

    const ptySessions = new Set(
      this.ptyManager?.listSessions().map((s) => s.claudeSessionId) ?? [],
    );

    const summaries: SessionSummary[] = [];

    for (const file of jsonlFiles) {
      const id = file.replace(".jsonl", "");
      if (!UUID_RE.test(id)) continue;

      try {
        const filePath = join(this.projectDir, file);
        const fileStat = await stat(filePath);
        const raw = await readFile(filePath, "utf-8");
        const lines = parseLines(raw);

        let title = "";
        let timestamp = "";
        let lastActivity = "";
        let model = "";
        let messageCount = 0;

        for (const line of lines) {
          if (SKIP_TYPES.has(line.type)) continue;

          // Track timestamps
          if (line.timestamp) {
            if (!timestamp) timestamp = line.timestamp;
            lastActivity = line.timestamp;
          }

          // First user message = title
          if (!title && isRealUserMessage(line)) {
            const text = extractTextFromContent(line.message!.content!);
            title = text.slice(0, 100);
          }

          // Count real user messages and final assistant messages
          if (isRealUserMessage(line)) messageCount++;
          if (line.type === "assistant" && line.message?.stop_reason === "end_turn") {
            messageCount++;
            if (!model && line.message.model) model = line.message.model;
          }

        }

        if (!title && !timestamp) continue; // skip empty/system-only sessions

        summaries.push({
          id,
          title: title || "(no prompt)",
          timestamp: timestamp || fileStat.mtime.toISOString(),
          lastActivity: lastActivity || fileStat.mtime.toISOString(),
          model: model || "unknown",
          messageCount,
          costUsd: 0, // JSONL doesn't store cost directly; could estimate from tokens
          hasPty: ptySessions.has(id),
        });
      } catch {
        // skip unreadable files
      }
    }

    // Sort by lastActivity descending
    summaries.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
    this.listCache = { summaries, mtimes: new Map(), cachedAt: Date.now() };
    return summaries;
  }

  async getConversation(sessionId: string): Promise<SessionDetail | null> {
    if (!UUID_RE.test(sessionId)) return null;

    const filePath = join(this.projectDir, `${sessionId}.jsonl`);
    if (!existsSync(filePath)) return null;

    const raw = await readFile(filePath, "utf-8");
    const lines = parseLines(raw);

    const messages: ConversationMessage[] = [];
    let model = "";
    for (const line of lines) {
      if (SKIP_TYPES.has(line.type)) continue;
      const content = line.message?.content;
      if (!Array.isArray(content)) continue;

      // Real user message
      if (isRealUserMessage(line)) {
        messages.push({
          role: "user",
          content: extractTextFromContent(content),
          timestamp: line.timestamp ?? "",
        });
        continue;
      }

      // Tool result (type=user with tool_result content)
      if (isToolResultLine(line)) {
        const resultText = extractToolResultText(content);
        const toolUseId = content.find((b) => b.type === "tool_result")?.tool_use_id;
        if (toolUseId) {
          messages.push({
            role: "tool_result",
            content: resultText.slice(0, 5000), // truncate large tool outputs
            timestamp: line.timestamp ?? "",
            toolUseId,
          });
        }
        continue;
      }

      // Assistant message — skip streaming chunks (stop_reason === null)
      if (line.type === "assistant") {
        const stopReason = line.message?.stop_reason;
        if (stopReason === null || stopReason === undefined) continue;

        if (!model && line.message?.model) model = line.message.model;

        const usage = line.message?.usage;

        // Extract content blocks
        let textContent = "";
        let thinkingContent = "";

        for (const block of content) {
          if (block.type === "text" && block.text) {
            textContent += block.text;
          } else if (block.type === "thinking" && block.thinking) {
            thinkingContent += block.thinking;
          } else if (block.type === "tool_use") {
            messages.push({
              role: "tool_use",
              content: "",
              timestamp: line.timestamp ?? "",
              toolName: block.name,
              toolInput: block.input,
              toolUseId: block.id,
              model: line.message?.model,
            });
          }
        }

        if (textContent) {
          messages.push({
            role: "assistant",
            content: textContent,
            timestamp: line.timestamp ?? "",
            model: line.message?.model,
            thinkingContent: thinkingContent || undefined,
            tokensIn: usage?.input_tokens,
            tokensOut: usage?.output_tokens,
          });
        }
      }
    }

    return {
      id: sessionId,
      messages,
      totalCostUsd: 0,
      model: model || "unknown",
    };
  }
}
