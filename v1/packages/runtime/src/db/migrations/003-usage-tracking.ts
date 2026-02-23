import type Database from "better-sqlite3";

const USAGE_COLUMNS: Array<[string, string]> = [
  ["total_cost_usd", "REAL NOT NULL DEFAULT 0.0"],
  ["total_input_tokens", "INTEGER NOT NULL DEFAULT 0"],
  ["total_output_tokens", "INTEGER NOT NULL DEFAULT 0"],
  ["total_duration_ms", "INTEGER NOT NULL DEFAULT 0"],
  ["turn_count", "INTEGER NOT NULL DEFAULT 0"],
];

export const migration003 = {
  up(db: Database.Database): void {
    const cols = new Set(
      (db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>)
        .map((c) => c.name),
    );

    for (const [name, def] of USAGE_COLUMNS) {
      if (!cols.has(name)) {
        db.exec(`ALTER TABLE sessions ADD COLUMN ${name} ${def};`);
      }
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS deleted_sessions (
        sdk_session_id TEXT PRIMARY KEY,
        deleted_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  },
};
