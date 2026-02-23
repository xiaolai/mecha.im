import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type Database from "better-sqlite3";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDatabase, runMigrations } from "../src/db/sqlite.js";
import { SessionManager, MAX_SESSIONS, resolveProjectDir } from "../src/agent/session-manager.js";
import type { MechaId } from "@mecha/core";
import {
  SessionNotFoundError,
  SessionBusyError,
  SessionCapReachedError,
} from "@mecha/contracts";

// Mock the Claude Agent SDK dynamic import
const mockQuery = vi.fn();
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

function createMockStream(messages: unknown[]) {
  return (async function* () {
    for (const m of messages) yield m;
  })();
}

const AGENT_OPTS = {
  mechaId: "mx-test" as MechaId,
  workingDirectory: "/tmp",
};

describe("SessionManager", () => {
  let db: Database.Database;
  let sm: SessionManager;

  beforeEach(() => {
    db = createDatabase(":memory:");
    runMigrations(db);
    sm = new SessionManager(db, AGENT_OPTS);
    mockQuery.mockReset();
  });

  afterEach(() => {
    if (db) db.close();
  });

  // --- create ---

  it("create() returns session with uuid, idle state, zero usage", () => {
    const session = sm.create();
    expect(session.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(session.state).toBe("idle");
    expect(session.title).toBe("");
    expect(session.messageCount).toBe(0);
    expect(session.lastMessageAt).toBeNull();
    expect(typeof session.createdAt).toBe("string");
    expect(session.usage).toEqual({
      totalCostUsd: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalDurationMs: 0,
      turnCount: 0,
    });
  });

  it("create() at MAX_SESSIONS cap throws SessionCapReachedError", () => {
    for (let i = 0; i < MAX_SESSIONS; i++) {
      db.prepare(
        "INSERT INTO sessions (id, title, config) VALUES (?, '', '{}')",
      ).run(`session-${i}`);
    }
    expect(() => sm.create()).toThrow(SessionCapReachedError);
  });

  it("create() at cap-1, delete one, create again succeeds", () => {
    for (let i = 0; i < MAX_SESSIONS; i++) {
      db.prepare(
        "INSERT INTO sessions (id, title, config) VALUES (?, '', '{}')",
      ).run(`session-${i}`);
    }
    // Delete one to make room
    sm.delete("session-0");
    const session = sm.create();
    expect(session.sessionId).toBeDefined();
    expect(session.state).toBe("idle");
  });

  // --- get ---

  it("get() returns undefined for nonexistent id", () => {
    const result = sm.get("nonexistent-id");
    expect(result).toBeUndefined();
  });

  it("get() includes usage field", () => {
    const session = sm.create();
    const detail = sm.get(session.sessionId);
    expect(detail).toBeDefined();
    expect(detail!.usage).toEqual({
      totalCostUsd: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalDurationMs: 0,
      turnCount: 0,
    });
  });

  // --- list ---

  it("list() returns sessions ordered by last_message_at desc with usage", () => {
    // Create three sessions with different updated_at times
    db.prepare(
      "INSERT INTO sessions (id, title, config, last_message_at) VALUES ('s1', 'first', '{}', '2024-01-01 00:00:00')",
    ).run();
    db.prepare(
      "INSERT INTO sessions (id, title, config, last_message_at) VALUES ('s2', 'second', '{}', '2024-01-03 00:00:00')",
    ).run();
    db.prepare(
      "INSERT INTO sessions (id, title, config, last_message_at) VALUES ('s3', 'third', '{}', '2024-01-02 00:00:00')",
    ).run();

    const sessions = sm.list();
    expect(sessions).toHaveLength(3);
    expect(sessions[0].sessionId).toBe("s2");
    expect(sessions[1].sessionId).toBe("s3");
    expect(sessions[2].sessionId).toBe("s1");
    // Every session has usage
    for (const s of sessions) {
      expect(s.usage).toBeDefined();
      expect(s.usage.turnCount).toBe(0);
    }
  });

  // --- delete ---

  it("delete() returns true, session gone from DB", () => {
    const session = sm.create();
    const deleted = sm.delete(session.sessionId);
    expect(deleted).toBe(true);
    expect(sm.get(session.sessionId)).toBeUndefined();
  });

  it("delete() returns false for nonexistent", () => {
    const deleted = sm.delete("nonexistent-id");
    expect(deleted).toBe(false);
  });

  it("delete() on busy session: aborts first, then deletes", () => {
    const session = sm.create();
    // Mark session as busy in DB
    db.prepare("UPDATE sessions SET state = 'busy' WHERE id = ?").run(
      session.sessionId,
    );
    // Add to active map with an abort controller
    const abortController = new AbortController();
    const abortSpy = vi.spyOn(abortController, "abort");
    (sm as unknown as { active: Map<string, { abortController: AbortController }> }).active.set(
      session.sessionId,
      { abortController },
    );

    const deleted = sm.delete(session.sessionId);
    expect(deleted).toBe(true);
    expect(abortSpy).toHaveBeenCalled();
    expect(sm.get(session.sessionId)).toBeUndefined();
  });

  it("delete() records tombstone in deleted_sessions", () => {
    const session = sm.create();
    // Set sdk_session_id
    db.prepare("UPDATE sessions SET sdk_session_id = 'sdk-tomb-1' WHERE id = ?").run(session.sessionId);

    sm.delete(session.sessionId);

    const tombstone = db.prepare("SELECT sdk_session_id FROM deleted_sessions WHERE sdk_session_id = 'sdk-tomb-1'").get();
    expect(tombstone).toBeDefined();
  });

  it("delete() best-effort unlinks JSONL file", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "mecha-del-test-"));
    const smWithDir = new SessionManager(db, AGENT_OPTS, tmpDir);
    const session = smWithDir.create();
    db.prepare("UPDATE sessions SET sdk_session_id = 'sdk-del-jsonl' WHERE id = ?").run(session.sessionId);

    // Create the JSONL file
    const jsonlPath = join(tmpDir, "sdk-del-jsonl.jsonl");
    writeFileSync(jsonlPath, '{"type":"user","message":{"content":"hi"}}');
    expect(existsSync(jsonlPath)).toBe(true);

    smWithDir.delete(session.sessionId);
    expect(existsSync(jsonlPath)).toBe(false);
  });

  it("delete() succeeds when JSONL file doesn't exist", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "mecha-del-nojsonl-"));
    const smWithDir = new SessionManager(db, AGENT_OPTS, tmpDir);
    const session = smWithDir.create();
    db.prepare("UPDATE sessions SET sdk_session_id = 'sdk-no-file' WHERE id = ?").run(session.sessionId);

    // Don't create the JSONL file — delete should still succeed
    const deleted = smWithDir.delete(session.sessionId);
    expect(deleted).toBe(true);
  });

  it("delete() without projectDir skips JSONL cleanup", () => {
    const session = sm.create();
    db.prepare("UPDATE sessions SET sdk_session_id = 'sdk-nodir' WHERE id = ?").run(session.sessionId);

    // sm has no projectDir — should not throw
    const deleted = sm.delete(session.sessionId);
    expect(deleted).toBe(true);
  });

  // --- rename ---

  it("rename() updates title and returns updated summary with usage", () => {
    const session = sm.create({ title: "Old Title" });
    const result = sm.rename(session.sessionId, "New Title");
    expect(result.title).toBe("New Title");
    expect(result.sessionId).toBe(session.sessionId);
    expect(result.usage).toBeDefined();

    // Verify persistence
    const fromDb = sm.get(session.sessionId);
    expect(fromDb?.title).toBe("New Title");
  });

  it("rename() throws SessionNotFoundError for nonexistent session", () => {
    expect(() => sm.rename("no-such-id", "Title")).toThrow(SessionNotFoundError);
  });

  it("rename() with empty string after trim is a no-op", () => {
    const session = sm.create({ title: "Keep Me" });
    const result = sm.rename(session.sessionId, "   ");
    expect(result.title).toBe("Keep Me");
  });

  it("rename() truncates title to 200 chars", () => {
    const session = sm.create();
    const longTitle = "A".repeat(300);
    const result = sm.rename(session.sessionId, longTitle);
    expect(result.title).toBe("A".repeat(200));
  });

  it("rename() works on busy session", () => {
    const session = sm.create({ title: "Original" });
    db.prepare("UPDATE sessions SET state = 'busy' WHERE id = ?").run(session.sessionId);
    const result = sm.rename(session.sessionId, "Renamed While Busy");
    expect(result.title).toBe("Renamed While Busy");
    expect(result.state).toBe("busy");
  });

  it("rename() trims whitespace", () => {
    const session = sm.create();
    const result = sm.rename(session.sessionId, "  Trimmed Title  ");
    expect(result.title).toBe("Trimmed Title");
  });

  // --- sendMessage ---

  it("sendMessage() idle to busy to idle transition", async () => {
    const session = sm.create();

    mockQuery.mockReturnValue(
      createMockStream([
        {
          type: "assistant",
          message: { content: [{ type: "text", text: "Hello" }] },
          session_id: "sdk-123",
        },
      ]),
    );

    const messages: unknown[] = [];
    for await (const msg of sm.sendMessage(session.sessionId, "hi")) {
      messages.push(msg);
    }

    // After completion, state should be idle
    const updated = sm.get(session.sessionId);
    expect(updated?.state).toBe("idle");
    expect(messages).toHaveLength(1);
  });

  it("sendMessage() records user msg before query, assistant msg after", async () => {
    const session = sm.create();

    mockQuery.mockReturnValue(
      createMockStream([
        {
          type: "assistant",
          message: { content: [{ type: "text", text: "Reply here" }] },
          session_id: "sdk-456",
        },
      ]),
    );

    for await (const _msg of sm.sendMessage(session.sessionId, "user input")) {
      // consume stream
    }

    const detail = sm.get(session.sessionId);
    expect(detail?.messages).toHaveLength(2);
    expect(detail?.messages[0].role).toBe("user");
    expect(detail?.messages[0].content).toBe("user input");
    expect(detail?.messages[1].role).toBe("assistant");
    expect(detail?.messages[1].content).toBe("Reply here");
  });

  it("sendMessage() first message: no resume, captures sdkSessionId", async () => {
    const session = sm.create();

    mockQuery.mockReturnValue(
      createMockStream([
        {
          type: "assistant",
          message: { content: [{ type: "text", text: "Hi" }] },
          session_id: "sdk-first-session",
        },
      ]),
    );

    for await (const _msg of sm.sendMessage(session.sessionId, "hello")) {
      // consume
    }

    // Verify query was called without resume option
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const callArgs = mockQuery.mock.calls[0][0];
    expect(callArgs.options.resume).toBeUndefined();

    // Verify sdkSessionId was captured in DB
    const row = db
      .prepare("SELECT sdk_session_id FROM sessions WHERE id = ?")
      .get(session.sessionId) as { sdk_session_id: string | null };
    expect(row.sdk_session_id).toBe("sdk-first-session");
  });

  it("sendMessage() second message: passes resume option", async () => {
    const session = sm.create();

    // First message - establish SDK session
    mockQuery.mockReturnValue(
      createMockStream([
        {
          type: "assistant",
          message: { content: [{ type: "text", text: "first" }] },
          session_id: "sdk-resume-id",
        },
      ]),
    );
    for await (const _msg of sm.sendMessage(session.sessionId, "msg1")) {
      // consume
    }

    // Second message - should pass resume
    mockQuery.mockReturnValue(
      createMockStream([
        {
          type: "assistant",
          message: { content: [{ type: "text", text: "second" }] },
          session_id: "sdk-resume-id",
        },
      ]),
    );
    for await (const _msg of sm.sendMessage(session.sessionId, "msg2")) {
      // consume
    }

    expect(mockQuery).toHaveBeenCalledTimes(2);
    const secondCallArgs = mockQuery.mock.calls[1][0];
    expect(secondCallArgs.options.resume).toBe("sdk-resume-id");
  });

  it("sendMessage() on busy throws SessionBusyError", async () => {
    const session = sm.create();
    db.prepare("UPDATE sessions SET state = 'busy' WHERE id = ?").run(
      session.sessionId,
    );

    await expect(async () => {
      for await (const _msg of sm.sendMessage(session.sessionId, "hi")) {
        // consume
      }
    }).rejects.toThrow(SessionBusyError);
  });

  it("sendMessage() on nonexistent throws SessionNotFoundError", async () => {
    await expect(async () => {
      for await (const _msg of sm.sendMessage("no-such-id", "hi")) {
        // consume
      }
    }).rejects.toThrow(SessionNotFoundError);
  });

  it("sendMessage() SDK query throws: state returns to idle", async () => {
    const session = sm.create();

    mockQuery.mockImplementation(() => {
      return (async function* () {
        throw new Error("SDK failure");
      })();
    });

    await expect(async () => {
      for await (const _msg of sm.sendMessage(session.sessionId, "fail")) {
        // consume
      }
    }).rejects.toThrow("SDK failure");

    const updated = sm.get(session.sessionId);
    expect(updated?.state).toBe("idle");
  });

  it("sendMessage() captures result event usage", async () => {
    const session = sm.create();

    mockQuery.mockReturnValue(
      createMockStream([
        {
          type: "assistant",
          message: { content: [{ type: "text", text: "Hi" }] },
          session_id: "sdk-usage",
        },
        {
          type: "result",
          total_cost_usd: 0.0035,
          duration_ms: 1500,
          usage: { input_tokens: 100, output_tokens: 50 },
          session_id: "sdk-usage",
        },
      ]),
    );

    for await (const _msg of sm.sendMessage(session.sessionId, "hello")) {
      // consume
    }

    const detail = sm.get(session.sessionId);
    expect(detail?.usage.totalCostUsd).toBe(0.0035);
    expect(detail?.usage.totalInputTokens).toBe(100);
    expect(detail?.usage.totalOutputTokens).toBe(50);
    expect(detail?.usage.totalDurationMs).toBe(1500);
    expect(detail?.usage.turnCount).toBe(1);
  });

  it("sendMessage() without result event keeps usage at zero", async () => {
    const session = sm.create();

    mockQuery.mockReturnValue(
      createMockStream([
        {
          type: "assistant",
          message: { content: [{ type: "text", text: "No result event" }] },
          session_id: "sdk-noresult",
        },
      ]),
    );

    for await (const _msg of sm.sendMessage(session.sessionId, "hello")) {
      // consume
    }

    const detail = sm.get(session.sessionId);
    expect(detail?.usage.totalCostUsd).toBe(0);
    expect(detail?.usage.turnCount).toBe(0);
  });

  it("sendMessage() accumulates usage across multiple calls", async () => {
    const session = sm.create();

    // First call
    mockQuery.mockReturnValue(
      createMockStream([
        { type: "assistant", message: { content: [{ type: "text", text: "1" }] }, session_id: "sdk-acc" },
        { type: "result", total_cost_usd: 0.01, duration_ms: 1000, usage: { input_tokens: 50, output_tokens: 25 } },
      ]),
    );
    for await (const _msg of sm.sendMessage(session.sessionId, "msg1")) { /* consume */ }

    // Second call
    mockQuery.mockReturnValue(
      createMockStream([
        { type: "assistant", message: { content: [{ type: "text", text: "2" }] }, session_id: "sdk-acc" },
        { type: "result", total_cost_usd: 0.02, duration_ms: 2000, usage: { input_tokens: 100, output_tokens: 75 } },
      ]),
    );
    for await (const _msg of sm.sendMessage(session.sessionId, "msg2")) { /* consume */ }

    const detail = sm.get(session.sessionId);
    expect(detail?.usage.totalCostUsd).toBeCloseTo(0.03);
    expect(detail?.usage.totalInputTokens).toBe(150);
    expect(detail?.usage.totalOutputTokens).toBe(100);
    expect(detail?.usage.totalDurationMs).toBe(3000);
    expect(detail?.usage.turnCount).toBe(2);
  });

  // --- interrupt ---

  it("interrupt() on busy: aborts, returns true", () => {
    const session = sm.create();
    db.prepare("UPDATE sessions SET state = 'busy' WHERE id = ?").run(
      session.sessionId,
    );
    const abortController = new AbortController();
    const abortSpy = vi.spyOn(abortController, "abort");
    (sm as unknown as { active: Map<string, { abortController: AbortController }> }).active.set(
      session.sessionId,
      { abortController },
    );

    const result = sm.interrupt(session.sessionId);
    expect(result).toBe(true);
    expect(abortSpy).toHaveBeenCalled();

    const updated = sm.get(session.sessionId);
    expect(updated?.state).toBe("idle");
  });

  it("interrupt() on idle: returns false", () => {
    const session = sm.create();
    const result = sm.interrupt(session.sessionId);
    expect(result).toBe(false);
  });

  it("interrupt() on nonexistent: throws SessionNotFoundError", () => {
    expect(() => sm.interrupt("no-such-id")).toThrow(SessionNotFoundError);
  });

  // --- updateConfig ---

  it("updateConfig() merges config, persists to DB", () => {
    const session = sm.create();
    const updated = sm.updateConfig(session.sessionId, {
      maxTurns: 10,
      model: "claude-sonnet-4-20250514",
    });

    expect(updated.config).toEqual({
      maxTurns: 10,
      model: "claude-sonnet-4-20250514",
    });

    // Verify persistence
    const fromDb = sm.get(session.sessionId);
    expect(fromDb?.config).toEqual({
      maxTurns: 10,
      model: "claude-sonnet-4-20250514",
    });
  });

  it("updateConfig() on busy session throws SessionBusyError", () => {
    const session = sm.create();
    db.prepare("UPDATE sessions SET state = 'busy' WHERE id = ?").run(
      session.sessionId,
    );

    expect(() =>
      sm.updateConfig(session.sessionId, { maxTurns: 5 }),
    ).toThrow(SessionBusyError);
  });

  it("updateConfig() on nonexistent session throws SessionNotFoundError", () => {
    expect(() =>
      sm.updateConfig("no-such-id", { maxTurns: 5 }),
    ).toThrow(SessionNotFoundError);
  });

  // --- cleanup ---

  it("cleanup() removes sessions older than TTL", () => {
    // Insert an old idle session with old updated_at
    db.prepare(
      "INSERT INTO sessions (id, title, config, updated_at, last_message_at) VALUES ('old-session', '', '{}', '2020-01-01 00:00:00', '2020-01-01 00:00:00')",
    ).run();
    // Insert a recent session
    sm.create({ title: "recent" });

    const removed = sm.cleanup();
    expect(removed).toBe(1);

    // Old session should be gone
    expect(sm.get("old-session")).toBeUndefined();
  });

  it("cleanup() keeps busy sessions regardless of age", () => {
    db.prepare(
      "INSERT INTO sessions (id, title, state, config, updated_at, last_message_at) VALUES ('busy-old', '', 'busy', '{}', '2020-01-01 00:00:00', '2020-01-01 00:00:00')",
    ).run();

    sm.cleanup();

    // Busy session should still exist
    const session = sm.get("busy-old");
    expect(session).toBeDefined();
    expect(session?.state).toBe("busy");
  });

  it("cleanup() records tombstones for expired sessions", () => {
    db.prepare(
      "INSERT INTO sessions (id, sdk_session_id, title, config, updated_at, last_message_at) VALUES ('old-tomb', 'sdk-old-tomb', '', '{}', '2020-01-01 00:00:00', '2020-01-01 00:00:00')",
    ).run();

    sm.cleanup();

    const tombstone = db.prepare("SELECT sdk_session_id FROM deleted_sessions WHERE sdk_session_id = 'sdk-old-tomb'").get();
    expect(tombstone).toBeDefined();
  });

  it("cleanup() best-effort unlinks JSONL files for expired sessions", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "mecha-cleanup-test-"));
    const smWithDir = new SessionManager(db, AGENT_OPTS, tmpDir);

    db.prepare(
      "INSERT INTO sessions (id, sdk_session_id, title, config, updated_at, last_message_at) VALUES ('old-jsonl', 'sdk-old-jsonl', '', '{}', '2020-01-01 00:00:00', '2020-01-01 00:00:00')",
    ).run();

    const jsonlPath = join(tmpDir, "sdk-old-jsonl.jsonl");
    writeFileSync(jsonlPath, '{"type":"user"}');
    expect(existsSync(jsonlPath)).toBe(true);

    smWithDir.cleanup();

    expect(existsSync(jsonlPath)).toBe(false);
  });

  // --- create with options ---

  it("create() with title and config stores them", () => {
    const session = sm.create({ title: "My Session", config: { maxTurns: 10, model: "test-model", systemPrompt: "Be helpful" } });
    expect(session.title).toBe("My Session");
    const detail = sm.get(session.sessionId);
    expect(detail?.config).toEqual({ maxTurns: 10, model: "test-model", systemPrompt: "Be helpful" });
  });

  // --- sendMessage with config options ---

  it("sendMessage() passes config options (model, maxTurns, systemPrompt) to SDK", async () => {
    const session = sm.create({ config: { model: "claude-opus-4", maxTurns: 5, systemPrompt: "Test prompt" } });

    mockQuery.mockReturnValue(
      createMockStream([
        { type: "assistant", message: { content: [{ type: "text", text: "ok" }] }, session_id: "sdk-config" },
      ]),
    );

    for await (const _msg of sm.sendMessage(session.sessionId, "hello")) {
      // consume
    }

    const callArgs = mockQuery.mock.calls[0][0];
    expect(callArgs.options.model).toBe("claude-opus-4");
    expect(callArgs.options.maxTurns).toBe(5);
    expect(callArgs.options.systemPrompt).toBe("Test prompt");
  });

  // --- sendMessage abort signal ---

  it("sendMessage() client abort: state returns to idle", async () => {
    const session = sm.create();

    let yieldControl!: () => void;
    const waitForAbort = new Promise<void>((resolve) => { yieldControl = resolve; });

    mockQuery.mockImplementation(() => {
      return (async function* () {
        yield { type: "assistant", message: { content: [{ type: "text", text: "partial" }] }, session_id: "sdk-abort" };
        await waitForAbort;
        yield { type: "assistant", message: { content: [{ type: "text", text: " more" }] } };
      })();
    });

    // Access active map to get abort controller after sendMessage starts
    const activeMap = (sm as unknown as { active: Map<string, { abortController: AbortController }> }).active;

    const gen = sm.sendMessage(session.sessionId, "test");
    const iter = gen[Symbol.asyncIterator]();

    // Get first message
    await iter.next();

    // Abort the session
    const entry = activeMap.get(session.sessionId);
    expect(entry).toBeDefined();
    entry!.abortController.abort();
    yieldControl();

    // Consume remaining
    await iter.next();

    const updated = sm.get(session.sessionId);
    expect(updated?.state).toBe("idle");
  });

  // --- startCleanup and shutdown ---

  it("startCleanup() starts interval, shutdown() clears it and aborts active sessions", () => {
    const session = sm.create();
    // Mark session busy with an active controller
    db.prepare("UPDATE sessions SET state = 'busy' WHERE id = ?").run(session.sessionId);
    const abortController = new AbortController();
    const abortSpy = vi.spyOn(abortController, "abort");
    (sm as unknown as { active: Map<string, { abortController: AbortController }> }).active.set(
      session.sessionId,
      { abortController },
    );

    sm.startCleanup();

    // Verify interval is set
    const interval = (sm as unknown as { cleanupInterval: ReturnType<typeof setInterval> | null }).cleanupInterval;
    expect(interval).not.toBeNull();

    // Shutdown
    sm.shutdown();

    // Verify abort called
    expect(abortSpy).toHaveBeenCalled();

    // Verify busy sessions marked idle
    const updated = sm.get(session.sessionId);
    expect(updated?.state).toBe("idle");

    // Verify interval cleared
    const afterInterval = (sm as unknown as { cleanupInterval: ReturnType<typeof setInterval> | null }).cleanupInterval;
    expect(afterInterval).toBeNull();
  });

  // --- cleanup cleans active map ---

  it("cleanup() keeps active entries that still exist in DB", () => {
    const session = sm.create();
    const activeMap = (sm as unknown as { active: Map<string, { abortController: AbortController }> }).active;
    // Session exists in DB AND is in active map
    activeMap.set(session.sessionId, { abortController: new AbortController() });

    sm.cleanup();

    // Should NOT be removed from active map because the session still exists in DB
    expect(activeMap.has(session.sessionId)).toBe(true);
  });

  it("cleanup() removes stale entries from active map", () => {
    const activeMap = (sm as unknown as { active: Map<string, { abortController: AbortController }> }).active;
    // Add a stale entry (session doesn't exist in DB)
    activeMap.set("stale-session", { abortController: new AbortController() });

    sm.cleanup();

    expect(activeMap.has("stale-session")).toBe(false);
  });

  // --- sendMessage with partial content on error ---

  it("sendMessage() saves partial assistant text on error", async () => {
    const session = sm.create();

    mockQuery.mockImplementation(() => {
      return (async function* () {
        yield { type: "assistant", message: { content: [{ type: "text", text: "partial response" }] }, session_id: "sdk-partial" };
        throw new Error("Stream interrupted");
      })();
    });

    await expect(async () => {
      for await (const _msg of sm.sendMessage(session.sessionId, "test")) {
        // consume
      }
    }).rejects.toThrow("Stream interrupted");

    // Verify partial assistant text was saved
    const detail = sm.get(session.sessionId);
    expect(detail?.messages).toHaveLength(2); // user + partial assistant
    expect(detail?.messages[1].role).toBe("assistant");
    expect(detail?.messages[1].content).toBe("partial response");
    expect(detail?.state).toBe("idle");
  });

  // --- sendMessage with workingDirectory fallback and permission mode ---

  it("sendMessage() uses process.cwd() when workingDirectory is undefined", async () => {
    const smNoDir = new SessionManager(db, { mechaId: "mx-test" as any });
    const session = smNoDir.create();

    mockQuery.mockReturnValue(
      createMockStream([
        { type: "assistant", message: { content: [{ type: "text", text: "ok" }] }, session_id: "sdk-nodir" },
      ]),
    );

    for await (const _msg of smNoDir.sendMessage(session.sessionId, "hello")) {
      // consume
    }

    const callArgs = mockQuery.mock.calls[0][0];
    expect(callArgs.options.cwd).toBe(process.cwd());
  });

  it("sendMessage() uses full-auto permission mode from config", async () => {
    const session = sm.create({ config: { permissionMode: "full-auto" } });

    mockQuery.mockReturnValue(
      createMockStream([
        { type: "assistant", message: { content: [{ type: "text", text: "ok" }] }, session_id: "sdk-perm" },
      ]),
    );

    for await (const _msg of sm.sendMessage(session.sessionId, "hello")) {
      // consume
    }

    const callArgs = mockQuery.mock.calls[0][0];
    expect(callArgs.options.permissionMode).toBe("acceptEdits");
  });

  it("sendMessage() falls back to default for unknown permission mode in PERMISSION_MAP", async () => {
    // Create a session, then manually set an unknown permission mode in the DB config
    const session = sm.create();
    db.prepare("UPDATE sessions SET config = ? WHERE id = ?").run(
      JSON.stringify({ permissionMode: "bogus-mode" }),
      session.sessionId,
    );

    mockQuery.mockReturnValue(
      createMockStream([
        { type: "assistant", message: { content: [{ type: "text", text: "ok" }] }, session_id: "sdk-defperm" },
      ]),
    );

    for await (const _msg of sm.sendMessage(session.sessionId, "hello")) {
      // consume
    }

    const callArgs = mockQuery.mock.calls[0][0];
    expect(callArgs.options.permissionMode).toBe("default");
  });

  it("sendMessage() handles assistant message without message property", async () => {
    const session = sm.create();

    mockQuery.mockReturnValue(
      createMockStream([
        { type: "assistant", session_id: "sdk-nomsg" },
      ]),
    );

    for await (const _msg of sm.sendMessage(session.sessionId, "hello")) {
      // consume
    }

    const detail = sm.get(session.sessionId);
    // Only user message — assistant had no message property
    expect(detail?.messages).toHaveLength(1);
  });

  it("sendMessage() handles assistant message with no content array", async () => {
    const session = sm.create();

    mockQuery.mockReturnValue(
      createMockStream([
        { type: "assistant", message: { content: "not-an-array" }, session_id: "sdk-noarr" },
      ]),
    );

    for await (const _msg of sm.sendMessage(session.sessionId, "hello")) {
      // consume
    }

    const detail = sm.get(session.sessionId);
    // User message present, but no assistant text since content was not an array
    expect(detail?.messages).toHaveLength(1);
    expect(detail?.messages[0].role).toBe("user");
  });

  it("sendMessage() handles assistant message with non-text content blocks", async () => {
    const session = sm.create();

    mockQuery.mockReturnValue(
      createMockStream([
        { type: "assistant", message: { content: [{ type: "tool_use", id: "t1" }] }, session_id: "sdk-notxt" },
      ]),
    );

    for await (const _msg of sm.sendMessage(session.sessionId, "hello")) {
      // consume
    }

    const detail = sm.get(session.sessionId);
    // Only user message — no text blocks in assistant content
    expect(detail?.messages).toHaveLength(1);
  });

  // --- startCleanup interval actually runs cleanup ---

  it("startCleanup() interval callback invokes cleanup()", () => {
    vi.useFakeTimers();
    try {
      // Insert an old session that should be cleaned up
      db.prepare(
        "INSERT INTO sessions (id, title, config, updated_at, last_message_at) VALUES ('timer-old', '', '{}', '2020-01-01 00:00:00', '2020-01-01 00:00:00')",
      ).run();

      sm.startCleanup();

      // Advance time by 60 seconds to trigger the interval
      vi.advanceTimersByTime(60_000);

      // Old session should have been cleaned up
      expect(sm.get("timer-old")).toBeUndefined();

      sm.shutdown();
    } finally {
      vi.useRealTimers();
    }
  });

  // --- resetBusySessions ---

  it("shutdown() without startCleanup() still works", () => {
    const session = sm.create();
    db.prepare("UPDATE sessions SET state = 'busy' WHERE id = ?").run(session.sessionId);

    // Don't call startCleanup(), so cleanupInterval is null
    sm.shutdown();

    const updated = sm.get(session.sessionId);
    expect(updated?.state).toBe("idle");
  });

  it("resetBusySessions() sets all busy to idle", () => {
    db.prepare(
      "INSERT INTO sessions (id, title, state, config) VALUES ('b1', '', 'busy', '{}')",
    ).run();
    db.prepare(
      "INSERT INTO sessions (id, title, state, config) VALUES ('b2', '', 'busy', '{}')",
    ).run();
    db.prepare(
      "INSERT INTO sessions (id, title, state, config) VALUES ('i1', '', 'idle', '{}')",
    ).run();

    sm.resetBusySessions();

    const sessions = sm.list();
    for (const s of sessions) {
      expect(s.state).toBe("idle");
    }
  });

  // --- importTranscripts ---

  describe("importTranscripts", () => {
    function makeTmpDir(): string {
      return mkdtempSync(join(tmpdir(), "mecha-import-test-"));
    }

    function writeJsonl(dir: string, filename: string, lines: unknown[]): void {
      writeFileSync(join(dir, filename), lines.map((l) => JSON.stringify(l)).join("\n"));
    }

    it("imports JSONL transcripts as sessions with correct messages", () => {
      const dir = makeTmpDir();
      writeJsonl(dir, "sdk-session-1.jsonl", [
        { type: "user", message: { content: "Hello world" }, sessionId: "sdk-session-1", timestamp: "2024-06-01T10:00:00Z" },
        { type: "assistant", message: { content: [{ type: "text", text: "Hi there!" }] }, sessionId: "sdk-session-1", timestamp: "2024-06-01T10:00:05Z" },
        { type: "user", message: { content: "How are you?" }, sessionId: "sdk-session-1", timestamp: "2024-06-01T10:00:10Z" },
        { type: "assistant", message: { content: [{ type: "text", text: "I'm well!" }] }, sessionId: "sdk-session-1", timestamp: "2024-06-01T10:00:15Z" },
      ]);

      const imported = sm.importTranscripts(dir);
      expect(imported).toBe(1);

      const sessions = sm.list();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].title).toBe("Hello world");
      expect(sessions[0].messageCount).toBe(4);

      const detail = sm.get(sessions[0].sessionId);
      expect(detail?.messages[0].role).toBe("user");
      expect(detail?.messages[0].content).toBe("Hello world");
      expect(detail?.messages[1].role).toBe("assistant");
      expect(detail?.messages[1].content).toBe("Hi there!");
      expect(detail?.messages[2].role).toBe("user");
      expect(detail?.messages[2].content).toBe("How are you?");
      expect(detail?.messages[3].role).toBe("assistant");
      expect(detail?.messages[3].content).toBe("I'm well!");
    });

    it("is idempotent — second import returns 0", () => {
      const dir = makeTmpDir();
      writeJsonl(dir, "sdk-idem.jsonl", [
        { type: "user", message: { content: "test" }, timestamp: "2024-06-01T10:00:00Z" },
      ]);

      expect(sm.importTranscripts(dir)).toBe(1);
      expect(sm.importTranscripts(dir)).toBe(0);
      expect(sm.list()).toHaveLength(1);
    });

    it("skips files with no user/assistant messages", () => {
      const dir = makeTmpDir();
      writeJsonl(dir, "sdk-empty.jsonl", [
        { type: "queue-operation", timestamp: "2024-06-01T10:00:00Z" },
      ]);

      expect(sm.importTranscripts(dir)).toBe(0);
      expect(sm.list()).toHaveLength(0);
    });

    it("truncates title to 50 chars", () => {
      const dir = makeTmpDir();
      const longMessage = "A".repeat(100);
      writeJsonl(dir, "sdk-long.jsonl", [
        { type: "user", message: { content: longMessage }, timestamp: "2024-06-01T10:00:00Z" },
      ]);

      sm.importTranscripts(dir);
      const sessions = sm.list();
      expect(sessions[0].title).toBe("A".repeat(50));
    });

    it("preserves timestamps from JSONL", () => {
      const dir = makeTmpDir();
      writeJsonl(dir, "sdk-ts.jsonl", [
        { type: "user", message: { content: "hello" }, timestamp: "2024-03-15T14:30:00Z" },
        { type: "assistant", message: { content: [{ type: "text", text: "hi" }] }, timestamp: "2024-03-15T14:30:05Z" },
      ]);

      sm.importTranscripts(dir);
      const sessions = sm.list();
      expect(sessions[0].createdAt).toBe("2024-03-15 14:30:00");
      expect(sessions[0].lastMessageAt).toBe("2024-03-15 14:30:05");
    });

    it("returns 0 for nonexistent directory", () => {
      expect(sm.importTranscripts("/nonexistent/path/to/nowhere")).toBe(0);
    });

    it("skips non-jsonl files", () => {
      const dir = makeTmpDir();
      writeFileSync(join(dir, "notes.txt"), "not a transcript");
      writeJsonl(dir, "sdk-real.jsonl", [
        { type: "user", message: { content: "real" }, timestamp: "2024-06-01T10:00:00Z" },
      ]);

      expect(sm.importTranscripts(dir)).toBe(1);
      expect(sm.list()).toHaveLength(1);
    });

    it("imports multiple files", () => {
      const dir = makeTmpDir();
      writeJsonl(dir, "sdk-a.jsonl", [
        { type: "user", message: { content: "first chat" }, timestamp: "2024-06-01T10:00:00Z" },
      ]);
      writeJsonl(dir, "sdk-b.jsonl", [
        { type: "user", message: { content: "second chat" }, timestamp: "2024-06-02T10:00:00Z" },
      ]);

      expect(sm.importTranscripts(dir)).toBe(2);
      expect(sm.list()).toHaveLength(2);
    });

    it("skips assistant messages with empty text blocks", () => {
      const dir = makeTmpDir();
      writeJsonl(dir, "sdk-empty-text.jsonl", [
        { type: "user", message: { content: "hi" }, timestamp: "2024-06-01T10:00:00Z" },
        { type: "assistant", message: { content: [{ type: "text", text: "" }] }, timestamp: "2024-06-01T10:00:05Z" },
      ]);

      sm.importTranscripts(dir);
      const sessions = sm.list();
      expect(sessions[0].messageCount).toBe(1); // only user message
    });

    it("skips malformed JSON lines gracefully", () => {
      const dir = makeTmpDir();
      writeFileSync(join(dir, "sdk-bad.jsonl"), [
        '{"type":"user","message":{"content":"good"},"timestamp":"2024-06-01T10:00:00Z"}',
        "not valid json {{{",
        '{"type":"assistant","message":{"content":[{"type":"text","text":"ok"}]},"timestamp":"2024-06-01T10:00:05Z"}',
      ].join("\n"));

      sm.importTranscripts(dir);
      const sessions = sm.list();
      expect(sessions[0].messageCount).toBe(2);
    });

    it("skips queue-operation type messages", () => {
      const dir = makeTmpDir();
      writeJsonl(dir, "sdk-queue.jsonl", [
        { type: "user", message: { content: "hello" }, timestamp: "2024-06-01T10:00:00Z" },
        { type: "queue-operation", timestamp: "2024-06-01T10:00:01Z" },
        { type: "assistant", message: { content: [{ type: "text", text: "world" }] }, timestamp: "2024-06-01T10:00:05Z" },
      ]);

      sm.importTranscripts(dir);
      const detail = sm.get(sm.list()[0].sessionId);
      expect(detail?.messages).toHaveLength(2);
      expect(detail?.messages[0].content).toBe("hello");
      expect(detail?.messages[1].content).toBe("world");
    });

    it("handles assistant messages with string content", () => {
      const dir = makeTmpDir();
      writeJsonl(dir, "sdk-noarr.jsonl", [
        { type: "user", message: { content: "test" }, timestamp: "2024-06-01T10:00:00Z" },
        { type: "assistant", message: { content: "string-response" }, timestamp: "2024-06-01T10:00:05Z" },
      ]);

      sm.importTranscripts(dir);
      const detail = sm.get(sm.list()[0].sessionId);
      expect(detail?.messages).toHaveLength(2);
      expect(detail?.messages[1].content).toBe("string-response");
    });

    it("skips messages with non-string non-array content", () => {
      const dir = makeTmpDir();
      writeJsonl(dir, "sdk-badcontent.jsonl", [
        { type: "user", message: { content: 999 }, timestamp: "2024-06-01T10:00:00Z" },
        { type: "user", message: { content: "real" }, timestamp: "2024-06-01T10:00:05Z" },
      ]);

      sm.importTranscripts(dir);
      expect(sm.list()[0].messageCount).toBe(1);
    });

    it("falls back to current time when timestamp is missing", () => {
      const dir = makeTmpDir();
      writeJsonl(dir, "sdk-nots.jsonl", [
        { type: "user", message: { content: "no timestamp" } },
      ]);

      sm.importTranscripts(dir);
      const sessions = sm.list();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].createdAt).toBeDefined();
    });

    it("handles user messages with array content blocks (real SDK format)", () => {
      const dir = makeTmpDir();
      writeJsonl(dir, "sdk-realfmt.jsonl", [
        { type: "user", message: { role: "user", content: [{ type: "text", text: "Hello from SDK" }] }, timestamp: "2024-06-01T10:00:00Z" },
        { type: "assistant", message: { role: "assistant", content: [{ type: "thinking", text: "hmm" }, { type: "text", text: "Hi!" }] }, timestamp: "2024-06-01T10:00:05Z" },
      ]);

      sm.importTranscripts(dir);
      const detail = sm.get(sm.list()[0].sessionId);
      expect(detail?.messages).toHaveLength(2);
      expect(detail?.messages[0].content).toBe("Hello from SDK");
      expect(detail?.messages[1].content).toBe("Hi!"); // thinking blocks filtered out
    });

    it("skips user messages with non-string content", () => {
      const dir = makeTmpDir();
      writeJsonl(dir, "sdk-baduser.jsonl", [
        { type: "user", message: { content: 123 }, timestamp: "2024-06-01T10:00:00Z" },
        { type: "user", message: { content: "real" }, timestamp: "2024-06-01T10:00:05Z" },
      ]);

      sm.importTranscripts(dir);
      expect(sm.list()[0].messageCount).toBe(1);
      expect(sm.get(sm.list()[0].sessionId)?.messages[0].content).toBe("real");
    });

    it("uses empty title when only assistant messages exist", () => {
      const dir = makeTmpDir();
      writeJsonl(dir, "sdk-nouser.jsonl", [
        { type: "assistant", message: { content: [{ type: "text", text: "unsolicited" }] }, timestamp: "2024-06-01T10:00:00Z" },
      ]);

      sm.importTranscripts(dir);
      expect(sm.list()[0].title).toBe("");
    });

    it("skips tombstoned sdk_session_ids", () => {
      const dir = makeTmpDir();
      writeJsonl(dir, "sdk-tombstoned.jsonl", [
        { type: "user", message: { content: "I was deleted" }, timestamp: "2024-06-01T10:00:00Z" },
      ]);

      // Insert tombstone
      db.prepare("INSERT INTO deleted_sessions (sdk_session_id) VALUES ('sdk-tombstoned')").run();

      expect(sm.importTranscripts(dir)).toBe(0);
      expect(sm.list()).toHaveLength(0);
    });

    it("extracts usage from result event lines", () => {
      const dir = makeTmpDir();
      writeJsonl(dir, "sdk-with-result.jsonl", [
        { type: "user", message: { content: "hello" }, timestamp: "2024-06-01T10:00:00Z" },
        { type: "assistant", message: { content: [{ type: "text", text: "Hi!" }] }, timestamp: "2024-06-01T10:00:05Z" },
        { type: "result", total_cost_usd: 0.005, duration_ms: 2000, usage: { input_tokens: 200, output_tokens: 100 }, timestamp: "2024-06-01T10:00:06Z" },
      ]);

      sm.importTranscripts(dir);
      const sessions = sm.list();
      expect(sessions[0].usage.totalCostUsd).toBe(0.005);
      expect(sessions[0].usage.totalInputTokens).toBe(200);
      expect(sessions[0].usage.totalOutputTokens).toBe(100);
      expect(sessions[0].usage.totalDurationMs).toBe(2000);
      expect(sessions[0].usage.turnCount).toBe(1);
    });

    it("accumulates usage from multiple result events in JSONL", () => {
      const dir = makeTmpDir();
      writeJsonl(dir, "sdk-multi-result.jsonl", [
        { type: "user", message: { content: "msg1" }, timestamp: "2024-06-01T10:00:00Z" },
        { type: "assistant", message: { content: [{ type: "text", text: "r1" }] }, timestamp: "2024-06-01T10:00:05Z" },
        { type: "result", total_cost_usd: 0.01, duration_ms: 1000, usage: { input_tokens: 50, output_tokens: 25 } },
        { type: "user", message: { content: "msg2" }, timestamp: "2024-06-01T10:01:00Z" },
        { type: "assistant", message: { content: [{ type: "text", text: "r2" }] }, timestamp: "2024-06-01T10:01:05Z" },
        { type: "result", total_cost_usd: 0.02, duration_ms: 2000, usage: { input_tokens: 100, output_tokens: 75 } },
      ]);

      sm.importTranscripts(dir);
      const sessions = sm.list();
      expect(sessions[0].usage.totalCostUsd).toBeCloseTo(0.03);
      expect(sessions[0].usage.totalInputTokens).toBe(150);
      expect(sessions[0].usage.totalOutputTokens).toBe(100);
      expect(sessions[0].usage.totalDurationMs).toBe(3000);
      expect(sessions[0].usage.turnCount).toBe(2);
    });

    it("imported sessions with no result events have zero usage", () => {
      const dir = makeTmpDir();
      writeJsonl(dir, "sdk-no-result.jsonl", [
        { type: "user", message: { content: "hello" }, timestamp: "2024-06-01T10:00:00Z" },
        { type: "assistant", message: { content: [{ type: "text", text: "Hi!" }] }, timestamp: "2024-06-01T10:00:05Z" },
      ]);

      sm.importTranscripts(dir);
      const sessions = sm.list();
      expect(sessions[0].usage).toEqual({
        totalCostUsd: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalDurationMs: 0,
        turnCount: 0,
      });
    });
  });
});

// --- resolveProjectDir ---

describe("resolveProjectDir", () => {
  it("converts /home/mecha to SDK project dir with leading dash", () => {
    expect(resolveProjectDir("/home/mecha")).toBe("/home/mecha/.claude/projects/-home-mecha");
  });

  it("handles root path", () => {
    expect(resolveProjectDir("/")).toBe("/.claude/projects/-");
  });

  it("handles nested paths", () => {
    expect(resolveProjectDir("/home/user/projects/myapp")).toBe(
      "/home/user/projects/myapp/.claude/projects/-home-user-projects-myapp",
    );
  });
});
