import type Database from "better-sqlite3";

export interface ConfigEntry {
  key: string;
  value: string;
  updatedAt: string;
}

/**
 * Key-value config store backed by the SQLite `state` table.
 * Supports get, set, delete, and list operations.
 *
 * This enables zero-downtime configuration changes: the runtime
 * can read updated config values from the state table without
 * requiring a container restart.
 */
export class ConfigStore {
  constructor(private db: Database.Database) {}

  /** Get a config value by key. Returns null if not found. */
  get(key: string): string | null {
    const row = this.db
      .prepare("SELECT value FROM state WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  /** Set a config key-value pair (upsert). */
  set(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO state (key, value, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, value);
  }

  /** Delete a config key. Returns true if a row was deleted. */
  delete(key: string): boolean {
    const result = this.db.prepare("DELETE FROM state WHERE key = ?").run(key);
    return result.changes > 0;
  }

  /** List all config entries, optionally filtered by key prefix. */
  list(prefix?: string): ConfigEntry[] {
    if (prefix) {
      return this.db
        .prepare("SELECT key, value, updated_at as updatedAt FROM state WHERE key LIKE ? || '%' ORDER BY key")
        .all(prefix) as ConfigEntry[];
    }
    return this.db
      .prepare("SELECT key, value, updated_at as updatedAt FROM state ORDER BY key")
      .all() as ConfigEntry[];
  }
}
