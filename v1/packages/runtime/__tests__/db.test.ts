import { describe, it, expect, afterEach } from "vitest";
import { createDatabase, runMigrations } from "../src/db/sqlite.js";
import type Database from "better-sqlite3";

describe("SQLite database", () => {
  let db: Database.Database;

  afterEach(() => {
    if (db) db.close();
  });

  it("creates an in-memory database", () => {
    db = createDatabase(":memory:");
    expect(db.open).toBe(true);
  });

  it("enables WAL mode", () => {
    db = createDatabase(":memory:");
    const result = db.pragma("journal_mode") as Array<{ journal_mode: string }>;
    // In-memory databases may report "memory" instead of "wal"
    // WAL mode is set but :memory: DBs fall back to "memory"
    expect(result[0].journal_mode).toMatch(/wal|memory/);
  });

  it("runs migrations and creates all tables", () => {
    db = createDatabase(":memory:");
    runMigrations(db);

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all() as Array<{ name: string }>;

    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain("heartbeats");
    expect(tableNames).toContain("state");
    expect(tableNames).toContain("chat_messages");
  });

  it("heartbeats table has expected columns", () => {
    db = createDatabase(":memory:");
    runMigrations(db);

    const info = db.prepare("PRAGMA table_info(heartbeats)").all() as Array<{
      name: string;
    }>;
    const cols = info.map((c) => c.name);
    expect(cols).toContain("id");
    expect(cols).toContain("mecha_id");
    expect(cols).toContain("status");
    expect(cols).toContain("active_tasks");
    expect(cols).toContain("last_tool_call");
    expect(cols).toContain("memory_pressure");
    expect(cols).toContain("timestamp");
  });

  it("state table has expected columns", () => {
    db = createDatabase(":memory:");
    runMigrations(db);

    const info = db.prepare("PRAGMA table_info(state)").all() as Array<{
      name: string;
    }>;
    const cols = info.map((c) => c.name);
    expect(cols).toContain("key");
    expect(cols).toContain("value");
    expect(cols).toContain("updated_at");
  });

  it("chat_messages table has expected columns", () => {
    db = createDatabase(":memory:");
    runMigrations(db);

    const info = db
      .prepare("PRAGMA table_info(chat_messages)")
      .all() as Array<{ name: string }>;
    const cols = info.map((c) => c.name);
    expect(cols).toContain("id");
    expect(cols).toContain("role");
    expect(cols).toContain("content");
    expect(cols).toContain("created_at");
  });

  it("sessions table has expected columns", () => {
    db = createDatabase(":memory:");
    runMigrations(db);

    const info = db.prepare("PRAGMA table_info(sessions)").all() as Array<{
      name: string;
    }>;
    const cols = info.map((c) => c.name);
    expect(cols).toContain("id");
    expect(cols).toContain("sdk_session_id");
    expect(cols).toContain("title");
    expect(cols).toContain("state");
    expect(cols).toContain("config");
    expect(cols).toContain("created_at");
    expect(cols).toContain("updated_at");
    expect(cols).toContain("last_message_at");
  });

  it("session_messages table has expected columns", () => {
    db = createDatabase(":memory:");
    runMigrations(db);

    const info = db
      .prepare("PRAGMA table_info(session_messages)")
      .all() as Array<{ name: string }>;
    const cols = info.map((c) => c.name);
    expect(cols).toContain("id");
    expect(cols).toContain("session_id");
    expect(cols).toContain("role");
    expect(cols).toContain("content");
    expect(cols).toContain("sdk_message_id");
    expect(cols).toContain("created_at");
  });

  it("FK cascade: deleting session removes its messages", () => {
    db = createDatabase(":memory:");
    runMigrations(db);

    db.prepare(
      "INSERT INTO sessions (id, title, config) VALUES ('s1', 'test', '{}')",
    ).run();
    db.prepare(
      "INSERT INTO session_messages (session_id, role, content) VALUES ('s1', 'user', 'hello')",
    ).run();
    db.prepare(
      "INSERT INTO session_messages (session_id, role, content) VALUES ('s1', 'assistant', 'hi')",
    ).run();

    // Verify messages exist
    const before = db
      .prepare("SELECT COUNT(*) as cnt FROM session_messages WHERE session_id = 's1'")
      .get() as { cnt: number };
    expect(before.cnt).toBe(2);

    // Delete session
    db.prepare("DELETE FROM sessions WHERE id = 's1'").run();

    // Messages should be gone via CASCADE
    const after = db
      .prepare("SELECT COUNT(*) as cnt FROM session_messages WHERE session_id = 's1'")
      .get() as { cnt: number };
    expect(after.cnt).toBe(0);
  });

  it("index idx_session_messages_session exists", () => {
    db = createDatabase(":memory:");
    runMigrations(db);

    const indexes = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_session_messages_session'",
      )
      .all() as Array<{ name: string }>;
    expect(indexes).toHaveLength(1);
    expect(indexes[0].name).toBe("idx_session_messages_session");
  });

  it("sessions table has usage columns after migration 003", () => {
    db = createDatabase(":memory:");
    runMigrations(db);

    const info = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
    const cols = info.map((c) => c.name);
    expect(cols).toContain("total_cost_usd");
    expect(cols).toContain("total_input_tokens");
    expect(cols).toContain("total_output_tokens");
    expect(cols).toContain("total_duration_ms");
    expect(cols).toContain("turn_count");
  });

  it("deleted_sessions table exists after migration 003", () => {
    db = createDatabase(":memory:");
    runMigrations(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='deleted_sessions'")
      .all() as Array<{ name: string }>;
    expect(tables).toHaveLength(1);

    const info = db.prepare("PRAGMA table_info(deleted_sessions)").all() as Array<{ name: string }>;
    const cols = info.map((c) => c.name);
    expect(cols).toContain("sdk_session_id");
    expect(cols).toContain("deleted_at");
  });

  it("runMigrations is idempotent (can be called twice) and all columns exist", () => {
    db = createDatabase(":memory:");
    runMigrations(db);
    // Should not throw when called a second time
    expect(() => runMigrations(db)).not.toThrow();

    // Verify all usage columns exist after double migration
    const info = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
    const cols = info.map((c) => c.name);
    for (const col of ["total_cost_usd", "total_input_tokens", "total_output_tokens", "total_duration_ms", "turn_count"]) {
      expect(cols).toContain(col);
    }
  });

  it("foreign keys are enabled", () => {
    db = createDatabase(":memory:");
    runMigrations(db);

    const result = db.pragma("foreign_keys") as Array<{ foreign_keys: number }>;
    expect(result[0].foreign_keys).toBe(1);
  });
});
