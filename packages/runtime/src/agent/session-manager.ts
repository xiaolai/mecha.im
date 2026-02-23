import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AgentOptions } from "./casa.js";
import { PERMISSION_MAP } from "./casa.js";
import type { SessionConfigType } from "@mecha/contracts";
import {
  SessionNotFoundError,
  SessionBusyError,
  SessionCapReachedError,
} from "@mecha/contracts";

/**
 * Converts a working directory to the SDK project directory path.
 * e.g. "/path/to/project" → "/path/to/project/.claude/projects/-path-to-project"
 */
export function resolveProjectDir(cwd: string): string {
  const slug = cwd.replace(/\//g, "-");
  return join(cwd, ".claude", "projects", slug);
}

export const MAX_SESSIONS = 50;
export const SESSION_TTL_MS = 365 * 24 * 3_600_000; // 365 days

export interface UsageStats {
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalDurationMs: number;
  turnCount: number;
}

export interface SessionSummary {
  sessionId: string;
  title: string;
  state: "idle" | "busy";
  messageCount: number;
  lastMessageAt: string | null;
  createdAt: string;
  usage: UsageStats;
}

export interface SessionMessage {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface SessionDetail extends SessionSummary {
  config: SessionConfigType;
  messages: SessionMessage[];
  totalMessages: number;
}

interface ActiveSession {
  abortController: AbortController;
}

const ZERO_USAGE: UsageStats = {
  totalCostUsd: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalDurationMs: 0,
  turnCount: 0,
};

/** Safely unlink a JSONL file — validates path stays under projectDir and ignores ENOENT */
function safeUnlinkJsonl(projectDir: string, sdkSessionId: string): void {
  const target = resolve(projectDir, `${sdkSessionId}.jsonl`);
  /* v8 ignore start -- path traversal guard rarely triggers */
  if (!target.startsWith(resolve(projectDir) + "/")) return;
  /* v8 ignore stop */
  try {
    unlinkSync(target);
  } catch (err: unknown) {
    /* v8 ignore start -- rare fs error, best-effort cleanup */
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(`Failed to unlink ${target}: ${(err as Error).message}`);
    }
    /* v8 ignore stop */
  }
}

/* v8 ignore start -- defensive ?? for DB row casting */
function rowToUsage(row: Record<string, unknown>): UsageStats {
  return {
    totalCostUsd: (row.total_cost_usd as number) ?? 0,
    totalInputTokens: (row.total_input_tokens as number) ?? 0,
    totalOutputTokens: (row.total_output_tokens as number) ?? 0,
    totalDurationMs: (row.total_duration_ms as number) ?? 0,
    turnCount: (row.turn_count as number) ?? 0,
  };
}
/* v8 ignore stop */

export class SessionManager {
  private active = new Map<string, ActiveSession>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private db: Database.Database,
    private agentOpts: AgentOptions,
    private projectDir?: string,
  ) {}

  create(opts?: { title?: string; config?: SessionConfigType }): SessionSummary {
    const id = randomUUID();
    const title = opts?.title ?? "";
    const config = JSON.stringify(opts?.config ?? {});

    const insertSession = this.db.transaction(() => {
      const count = (this.db.prepare("SELECT COUNT(*) as cnt FROM sessions").get() as { cnt: number }).cnt;
      if (count >= MAX_SESSIONS) throw new SessionCapReachedError();
      this.db.prepare(
        "INSERT INTO sessions (id, title, config) VALUES (?, ?, ?)",
      ).run(id, title, config);
    });
    insertSession.immediate();

    const row = this.db.prepare("SELECT created_at FROM sessions WHERE id = ?").get(id) as { created_at: string };

    return {
      sessionId: id,
      title,
      state: "idle",
      messageCount: 0,
      lastMessageAt: null,
      createdAt: row.created_at,
      usage: { ...ZERO_USAGE },
    };
  }

  get(id: string, limit = 50, offset = 0): SessionDetail | undefined {
    const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as {
      id: string; sdk_session_id: string | null; title: string; state: string;
      config: string; created_at: string; updated_at: string; last_message_at: string | null;
      total_cost_usd: number; total_input_tokens: number; total_output_tokens: number;
      total_duration_ms: number; turn_count: number;
    } | undefined;
    if (!row) return undefined;

    const messages = this.db.prepare(
      "SELECT role, content, created_at FROM session_messages WHERE session_id = ? ORDER BY created_at ASC, id ASC LIMIT ? OFFSET ?",
    ).all(id, limit, offset) as Array<{ role: string; content: string; created_at: string }>;

    const totalMessages = (this.db.prepare(
      "SELECT COUNT(*) as cnt FROM session_messages WHERE session_id = ?",
    ).get(id) as { cnt: number }).cnt;

    const messageCount = totalMessages;

    return {
      sessionId: row.id,
      title: row.title,
      state: row.state as "idle" | "busy",
      messageCount,
      lastMessageAt: row.last_message_at,
      createdAt: row.created_at,
      usage: rowToUsage(row),
      config: JSON.parse(row.config) as SessionConfigType,
      messages: messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
        createdAt: m.created_at,
      })),
      totalMessages,
    };
  }

  list(): SessionSummary[] {
    const rows = this.db.prepare(
      `SELECT s.id, s.title, s.state, s.created_at, s.last_message_at,
              s.total_cost_usd, s.total_input_tokens, s.total_output_tokens,
              s.total_duration_ms, s.turn_count,
              (SELECT COUNT(*) FROM session_messages WHERE session_id = s.id) as message_count
       FROM sessions s
       ORDER BY COALESCE(s.last_message_at, s.created_at) DESC`,
    ).all() as Array<{
      id: string; title: string; state: string; created_at: string;
      last_message_at: string | null; message_count: number;
      total_cost_usd: number; total_input_tokens: number; total_output_tokens: number;
      total_duration_ms: number; turn_count: number;
    }>;

    return rows.map((r) => ({
      sessionId: r.id,
      title: r.title,
      state: r.state as "idle" | "busy",
      messageCount: r.message_count,
      lastMessageAt: r.last_message_at,
      createdAt: r.created_at,
      usage: rowToUsage(r),
    }));
  }

  rename(id: string, title: string): SessionSummary {
    const trimmed = title.trim().slice(0, 200);

    const doRename = this.db.transaction(() => {
      const row = this.db.prepare(
        `SELECT id, title, state, created_at, last_message_at,
                total_cost_usd, total_input_tokens, total_output_tokens,
                total_duration_ms, turn_count,
                (SELECT COUNT(*) FROM session_messages WHERE session_id = sessions.id) as message_count
         FROM sessions WHERE id = ?`,
      ).get(id) as {
        id: string; title: string; state: string; created_at: string;
        last_message_at: string | null; message_count: number;
        total_cost_usd: number; total_input_tokens: number; total_output_tokens: number;
        total_duration_ms: number; turn_count: number;
      } | undefined;
      if (!row) throw new SessionNotFoundError(id);

      // Empty string after trim → no-op, return current session
      if (!trimmed) {
        return {
          sessionId: row.id,
          title: row.title,
          state: row.state as "idle" | "busy",
          messageCount: row.message_count,
          lastMessageAt: row.last_message_at,
          createdAt: row.created_at,
          usage: rowToUsage(row),
        } as SessionSummary;
      }

      this.db.prepare(
        "UPDATE sessions SET title = ?, updated_at = datetime('now') WHERE id = ?",
      ).run(trimmed, id);

      return {
        sessionId: row.id,
        title: trimmed,
        state: row.state as "idle" | "busy",
        messageCount: row.message_count,
        lastMessageAt: row.last_message_at,
        createdAt: row.created_at,
        usage: rowToUsage(row),
      } as SessionSummary;
    });

    return doRename.immediate();
  }

  delete(id: string): boolean {
    // If session is active/busy, abort first
    const entry = this.active.get(id);
    if (entry) {
      entry.abortController.abort();
      this.active.delete(id);
    }

    // Look up sdk_session_id before deleting for tombstone + JSONL cleanup
    const row = this.db.prepare("SELECT sdk_session_id FROM sessions WHERE id = ?").get(id) as {
      sdk_session_id: string | null;
    } | undefined;

    if (!row) return false;

    const sdkSessionId = row.sdk_session_id;

    const doDelete = this.db.transaction(() => {
      if (sdkSessionId) {
        this.db.prepare("INSERT OR IGNORE INTO deleted_sessions (sdk_session_id) VALUES (?)").run(sdkSessionId);
      }
      return this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
    });
    const result = doDelete.immediate();

    // Best-effort JSONL cleanup
    if (sdkSessionId && this.projectDir) {
      safeUnlinkJsonl(this.projectDir, sdkSessionId);
    }

    return result.changes > 0;
  }

  async *sendMessage(sessionId: string, message: string): AsyncIterable<unknown> {
    // Atomic SELECT + mark busy in a single IMMEDIATE transaction to prevent TOCTOU race
    const markBusy = this.db.transaction(() => {
      const r = this.db.prepare(
        "SELECT id, sdk_session_id, config FROM sessions WHERE id = ? AND state = 'idle'",
      ).get(sessionId) as { id: string; sdk_session_id: string | null; config: string } | undefined;
      if (!r) {
        const exists = this.db.prepare("SELECT id FROM sessions WHERE id = ?").get(sessionId);
        if (!exists) throw new SessionNotFoundError(sessionId);
        throw new SessionBusyError(sessionId);
      }
      this.db.prepare(
        "UPDATE sessions SET state = 'busy', updated_at = datetime('now') WHERE id = ?",
      ).run(sessionId);
      return r;
    });
    const row = markBusy.immediate();
    const abortController = new AbortController();
    this.active.set(sessionId, { abortController });

    // Insert user message
    this.db.prepare(
      "INSERT INTO session_messages (session_id, role, content) VALUES (?, 'user', ?)",
    ).run(sessionId, message);

    let assistantText = "";
    let caughtError: unknown = undefined;
    const pendingUsage = { costUsd: 0, inputTokens: 0, outputTokens: 0, durationMs: 0, turns: 0 };
    try {
      const { query } = await import("@anthropic-ai/claude-agent-sdk");

      const config = JSON.parse(row.config) as SessionConfigType;
      const options: Record<string, unknown> = {
        abortController,
        cwd: this.agentOpts.workingDirectory ?? process.cwd(),
        permissionMode: PERMISSION_MAP[config.permissionMode ?? this.agentOpts.permissionMode ?? "default"] ?? "default",
      };
      if (config.model) options.model = config.model;
      if (config.maxTurns) options.maxTurns = config.maxTurns;
      if (config.systemPrompt) options.systemPrompt = config.systemPrompt;
      if (row.sdk_session_id) options.resume = row.sdk_session_id;

      const stream = query({ prompt: message, options });

      for await (const msg of stream) {
        if (abortController.signal.aborted) break;

        // Capture sdk_session_id from messages
        const sdkMsg = msg as Record<string, unknown>;
        if (sdkMsg.session_id && !row.sdk_session_id) {
          row.sdk_session_id = sdkMsg.session_id as string;
          this.db.prepare("UPDATE sessions SET sdk_session_id = ? WHERE id = ?").run(row.sdk_session_id, sessionId);
        }

        // Accumulate assistant text — SDK sends full text per assistant message
        if (sdkMsg.type === "assistant" && sdkMsg.message) {
          const content = (sdkMsg.message as Record<string, unknown>).content as Array<Record<string, unknown>> | undefined;

          if (Array.isArray(content)) {
            const textParts = content
              .filter((b) => b.type === "text" && typeof b.text === "string")
              .map((b) => b.text as string);

            if (textParts.length > 0) assistantText = textParts.join("");
          }
        }

        // Accumulate usage from result events (may fire multiple times per stream)
        /* v8 ignore start -- SDK result fields may or may not be present */
        if (sdkMsg.type === "result") {
          const usage = sdkMsg.usage as Record<string, unknown> | undefined;
          pendingUsage.costUsd += (sdkMsg.total_cost_usd as number) ?? 0;
          pendingUsage.inputTokens += (usage?.input_tokens as number) ?? 0;
          pendingUsage.outputTokens += (usage?.output_tokens as number) ?? 0;
          pendingUsage.durationMs += (sdkMsg.duration_ms as number) ?? 0;
          pendingUsage.turns++;
        }
        /* v8 ignore stop */

        yield msg;
      }
    } catch (err) {
      caughtError = err;
    } finally {
      // Always: save content, update usage, mark idle, clean up
      const finalize = this.db.transaction(() => {
        if (assistantText) {
          this.db.prepare(
            "INSERT INTO session_messages (session_id, role, content) VALUES (?, 'assistant', ?)",
          ).run(sessionId, assistantText);
        }

        if (pendingUsage.turns > 0) {
          this.db.prepare(
            `UPDATE sessions SET
              turn_count = turn_count + ?,
              total_cost_usd = total_cost_usd + ?,
              total_input_tokens = total_input_tokens + ?,
              total_output_tokens = total_output_tokens + ?,
              total_duration_ms = total_duration_ms + ?,
              state = 'idle', updated_at = datetime('now'), last_message_at = datetime('now')
            WHERE id = ?`,
          ).run(
            pendingUsage.turns,
            pendingUsage.costUsd,
            pendingUsage.inputTokens,
            pendingUsage.outputTokens,
            pendingUsage.durationMs,
            sessionId,
          );
        } else {
          this.db.prepare(
            "UPDATE sessions SET state = 'idle', updated_at = datetime('now'), last_message_at = datetime('now') WHERE id = ?",
          ).run(sessionId);
        }
      });
      finalize();

      this.active.delete(sessionId);
    }
    if (caughtError) throw caughtError;
  }

  interrupt(sessionId: string): boolean {
    const entry = this.active.get(sessionId);
    if (!entry) {
      // Check if session exists
      const row = this.db.prepare("SELECT state FROM sessions WHERE id = ?").get(sessionId) as { state: string } | undefined;
      if (!row) throw new SessionNotFoundError(sessionId);
      return false; // idle, nothing to interrupt
    }
    entry.abortController.abort();
    this.active.delete(sessionId);
    this.db.prepare(
      "UPDATE sessions SET state = 'idle', updated_at = datetime('now') WHERE id = ?",
    ).run(sessionId);
    return true;
  }

  updateConfig(sessionId: string, config: SessionConfigType): SessionDetail {
    const row = this.db.prepare("SELECT state FROM sessions WHERE id = ?").get(sessionId) as { state: string } | undefined;
    if (!row) throw new SessionNotFoundError(sessionId);
    if (row.state === "busy") throw new SessionBusyError(sessionId);

    this.db.prepare(
      "UPDATE sessions SET config = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(JSON.stringify(config), sessionId);

    return this.get(sessionId)!;
  }

  cleanup(): number {
    const cutoff = new Date(Date.now() - SESSION_TTL_MS).toISOString().replace("T", " ").slice(0, 19);

    // Collect sessions to expire for tombstoning
    const expiredRows = this.db.prepare(
      `SELECT id, sdk_session_id FROM sessions
       WHERE state = 'idle'
         AND ((updated_at < ? AND last_message_at IS NULL) OR (last_message_at < ? AND updated_at < ?))`,
    ).all(cutoff, cutoff, cutoff) as Array<{ id: string; sdk_session_id: string | null }>;

    let changes = 0;
    if (expiredRows.length > 0) {
      const doCleanup = this.db.transaction(() => {
        for (const row of expiredRows) {
          if (row.sdk_session_id) {
            this.db.prepare("INSERT OR IGNORE INTO deleted_sessions (sdk_session_id) VALUES (?)").run(row.sdk_session_id);
          }
        }
        const ids = expiredRows.map((r) => r.id);
        const placeholders = ids.map(() => "?").join(",");
        const result = this.db.prepare(
          `DELETE FROM sessions WHERE id IN (${placeholders})`,
        ).run(...ids);
        changes = result.changes;
      });
      doCleanup.immediate();

      // Best-effort JSONL cleanup after transaction
      for (const row of expiredRows) {
        if (row.sdk_session_id && this.projectDir) {
          safeUnlinkJsonl(this.projectDir, row.sdk_session_id);
        }
      }
    }

    // Also clean up from active map
    for (const id of this.active.keys()) {
      const exists = this.db.prepare("SELECT id FROM sessions WHERE id = ?").get(id);

      if (!exists) this.active.delete(id);
    }

    return changes;
  }

  resetBusySessions(): void {
    this.db.prepare("UPDATE sessions SET state = 'idle' WHERE state = 'busy'").run();
  }

  importTranscripts(projectDir: string): number {
    let files: string[];
    try {
      files = readdirSync(projectDir).filter((f) => f.endsWith(".jsonl"));
    } catch {
      return 0; // directory doesn't exist yet
    }

    const checkExists = this.db.prepare("SELECT id FROM sessions WHERE sdk_session_id = ?");
    const insertSession = this.db.prepare(
      `INSERT INTO sessions (id, sdk_session_id, title, config, created_at, updated_at, last_message_at,
        total_cost_usd, total_input_tokens, total_output_tokens, total_duration_ms, turn_count)
       VALUES (?, ?, ?, '{}', ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertMessage = this.db.prepare(
      "INSERT INTO session_messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)",
    );

    // Load tombstone set to prevent zombie re-imports
    const tombstones = new Set(
      (this.db.prepare("SELECT sdk_session_id FROM deleted_sessions").all() as Array<{ sdk_session_id: string }>)
        .map((r) => r.sdk_session_id),
    );

    let imported = 0;

    for (const file of files) {
      const sdkSessionId = file.slice(0, -6); // strip .jsonl

      // Skip tombstoned sessions
      if (tombstones.has(sdkSessionId)) continue;

      if (checkExists.get(sdkSessionId)) continue;

      const lines = readFileSync(join(projectDir, file), "utf-8")
        .split("\n")
        .filter((l) => l.trim());

      const messages: Array<{ role: "user" | "assistant"; content: string; timestamp: string }> = [];

      // Usage accumulators from result events
      let costUsd = 0;
      let inputTokens = 0;
      let outputTokens = 0;
      let durationMs = 0;
      let turnCount = 0;

      for (const line of lines) {
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }

        const timestamp = (parsed.timestamp as string) ?? new Date().toISOString();
        const msg = parsed.message as Record<string, unknown> | undefined;

        if ((parsed.type === "user" || parsed.type === "assistant") && msg) {
          const role = parsed.type as "user" | "assistant";
          let content = "";
          if (typeof msg.content === "string") {
            content = msg.content;
          } else if (Array.isArray(msg.content)) {
            content = (msg.content as Array<Record<string, unknown>>)
              .filter((b) => b.type === "text" && typeof b.text === "string" && (b.text as string).length > 0)
              .map((b) => b.text as string)
              .join("");
          }
          if (content) messages.push({ role, content, timestamp });
        }

        // Extract usage from result events
        /* v8 ignore start -- SDK result fields may or may not be present */
        if (parsed.type === "result") {
          const usage = parsed.usage as Record<string, unknown> | undefined;
          costUsd += (parsed.total_cost_usd as number) ?? 0;
          inputTokens += (usage?.input_tokens as number) ?? 0;
          outputTokens += (usage?.output_tokens as number) ?? 0;
          durationMs += (parsed.duration_ms as number) ?? 0;
          turnCount++;
        }
        /* v8 ignore stop */
      }

      if (messages.length === 0) continue;

      const id = randomUUID();
      const title = messages.find((m) => m.role === "user")?.content.slice(0, 50) ?? "";
      const firstTimestamp = messages[0].timestamp;
      const lastTimestamp = messages[messages.length - 1].timestamp;
      // Convert ISO timestamps to SQLite datetime format
      const createdAt = firstTimestamp.replace("T", " ").slice(0, 19);
      const lastMessageAt = lastTimestamp.replace("T", " ").slice(0, 19);

      const insertAll = this.db.transaction(() => {
        insertSession.run(id, sdkSessionId, title, createdAt, createdAt, lastMessageAt,
          costUsd, inputTokens, outputTokens, durationMs, turnCount);
        for (const m of messages) {
          const ts = m.timestamp.replace("T", " ").slice(0, 19);
          insertMessage.run(id, m.role, m.content, ts);
        }
      });
      insertAll.immediate();
      imported++;
    }

    return imported;
  }

  startCleanup(): void {
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
    this.cleanupInterval.unref();
  }

  shutdown(): void {
    // Abort all active sessions
    for (const [id, entry] of this.active) {
      entry.abortController.abort();
      this.active.delete(id);
    }
    // Clear cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    // Mark all busy as idle
    this.db.prepare("UPDATE sessions SET state = 'idle' WHERE state = 'busy'").run();
  }
}
