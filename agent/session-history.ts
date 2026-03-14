import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import type { PtyManager } from "./pty-manager.js";
import type { JContentBlock, ConversationMessage, SessionSummary, SessionDetail, SearchMatch, SearchResult } from "./session-history-types.js";
import {
  normalizeCwd, SKIP_TYPES, UUID_RE, isToolResultLine,
  collectMetaUuids, isRealUserMessage, extractTextFromContent,
  extractToolResultText, parseLines, extractSnippet,
} from "./session-history-utils.js";

export type { SearchMatch, SearchResult, SessionSummary, ConversationMessage, SessionDetail } from "./session-history-types.js";
export { extractSnippet } from "./session-history-utils.js";

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
        const metaUuids = collectMetaUuids(lines);

        for (const line of lines) {
          if (SKIP_TYPES.has(line.type)) continue;

          // Track timestamps
          if (line.timestamp) {
            if (!timestamp) timestamp = line.timestamp;
            lastActivity = line.timestamp;
          }

          // First user message = title
          if (!title && isRealUserMessage(line, metaUuids)) {
            const c = line.message!.content!;
            const text = typeof c === "string" ? c : extractTextFromContent(c as JContentBlock[]);
            title = text.slice(0, 100);
          }

          // Count real user messages and final assistant messages
          if (isRealUserMessage(line, metaUuids)) messageCount++;
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
    const metaUuids = collectMetaUuids(lines);
    for (const line of lines) {
      if (SKIP_TYPES.has(line.type)) continue;
      const content = line.message?.content;
      if (content === undefined || content === null) continue;

      // Real user message (string or array content)
      if (isRealUserMessage(line, metaUuids)) {
        const text = typeof content === "string"
          ? content
          : extractTextFromContent(content as JContentBlock[]);
        messages.push({
          role: "user",
          content: text,
          timestamp: line.timestamp ?? "",
        });
        continue;
      }

      if (!Array.isArray(content)) continue;

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

  /**
   * Search across all sessions for messages containing the query string.
   * Returns matched sessions with snippet context around each hit.
   */
  async search(query: string, limit = 20): Promise<SearchResult[]> {
    if (!query.trim() || !existsSync(this.projectDir)) return [];

    const needle = query.toLowerCase();
    const files = await readdir(this.projectDir);
    const jsonlFiles = files.filter((f) => {
      const id = f.replace(".jsonl", "");
      return f.endsWith(".jsonl") && UUID_RE.test(id);
    });

    const ptySessions = new Set(
      this.ptyManager?.listSessions().map((s) => s.claudeSessionId) ?? [],
    );

    // Search files concurrently in batches of 10
    const BATCH_SIZE = 10;
    const results: SearchResult[] = [];

    for (let i = 0; i < jsonlFiles.length; i += BATCH_SIZE) {
      const batch = jsonlFiles.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map((file) => this.searchFile(file, needle, ptySessions)),
      );
      for (const r of batchResults) {
        if (r) results.push(r);
      }
      if (results.length >= limit) break;
    }

    // Sort by lastActivity descending, then trim to limit
    results.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
    return results.slice(0, limit);
  }

  private async searchFile(file: string, needle: string, ptySessions: Set<string>): Promise<SearchResult | null> {
    const id = file.replace(".jsonl", "");
    try {
      const filePath = join(this.projectDir, file);
      const raw = await readFile(filePath, "utf-8");
      const lines = parseLines(raw);

      let title = "";
      let model = "";
      let lastActivity = "";
      const matches: SearchMatch[] = [];
      const metaUuids = collectMetaUuids(lines);

      for (const line of lines) {
        if (SKIP_TYPES.has(line.type)) continue;
        const content = line.message?.content;
        if (content === undefined || content === null) continue;

        if (line.timestamp) lastActivity = line.timestamp;

        // Extract title from first user message
        if (!title && isRealUserMessage(line, metaUuids)) {
          title = (typeof content === "string" ? content : extractTextFromContent(content as JContentBlock[])).slice(0, 100);
        }

        // Track model (consistent with list(): only from final assistant turn)
        if (!model && line.type === "assistant" && line.message?.stop_reason === "end_turn" && line.message.model) {
          model = line.message.model;
        }

        // Search in user messages
        if (isRealUserMessage(line, metaUuids)) {
          const text = typeof content === "string" ? content : extractTextFromContent(content as JContentBlock[]);
          if (text.toLowerCase().includes(needle)) {
            matches.push({
              role: "user",
              snippet: extractSnippet(text, needle),
              timestamp: line.timestamp ?? "",
            });
          }
        }

        // Search in assistant messages (final turn only)
        if (line.type === "assistant" && line.message?.stop_reason === "end_turn" && Array.isArray(content)) {
          const text = extractTextFromContent(content);
          if (text.toLowerCase().includes(needle)) {
            matches.push({
              role: "assistant",
              snippet: extractSnippet(text, needle),
              timestamp: line.timestamp ?? "",
            });
          }
        }
      }

      if (matches.length > 0) {
        return {
          id,
          title: title || "(no prompt)",
          model: model || "unknown",
          lastActivity,
          hasPty: ptySessions.has(id),
          matches: matches.slice(0, 5),
        };
      }
    } catch {
      // skip unreadable files
    }
    return null;
  }
}
