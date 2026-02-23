import Database from "better-sqlite3";
import { migration001 } from "./migrations/001-init.js";
import { migration002 } from "./migrations/002-sessions.js";
import { migration003 } from "./migrations/003-usage-tracking.js";

export function createDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

export function runMigrations(db: Database.Database): void {
  migration001.up(db);
  migration002.up(db);
  migration003.up(db);
}
