import type Database from "better-sqlite3";

export const migration001 = {
  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS heartbeats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mecha_id TEXT NOT NULL,
        status TEXT NOT NULL,
        active_tasks INTEGER NOT NULL DEFAULT 0,
        last_tool_call TEXT,
        memory_pressure REAL,
        timestamp TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS state (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  },
};
