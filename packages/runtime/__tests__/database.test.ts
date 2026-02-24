import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDatabase, runMigrations } from "../src/database.js";
import Database from "better-sqlite3";

describe("createDatabase", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-db-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates a database with WAL mode", () => {
    const db = createDatabase(join(tempDir, "test.db"));
    const mode = db.pragma("journal_mode", { simple: true }) as string;
    expect(mode).toBe("wal");
    db.close();
  });

  it("enables foreign keys", () => {
    const db = createDatabase(join(tempDir, "test.db"));
    const fk = db.pragma("foreign_keys", { simple: true }) as number;
    expect(fk).toBe(1);
    db.close();
  });

  it("creates sessions table", () => {
    const db = createDatabase(join(tempDir, "test.db"));
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'")
      .all() as Array<{ name: string }>;
    expect(tables).toHaveLength(1);
    expect(tables[0]!.name).toBe("sessions");
    db.close();
  });

  it("sessions table has correct columns", () => {
    const db = createDatabase(join(tempDir, "test.db"));
    const cols = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    expect(names).toContain("id");
    expect(names).toContain("title");
    expect(names).toContain("starred");
    expect(names).toContain("created_at");
    expect(names).toContain("updated_at");
    db.close();
  });

  it("is idempotent — can run migrations twice", () => {
    const db = createDatabase(join(tempDir, "test.db"));
    runMigrations(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'")
      .all() as Array<{ name: string }>;
    expect(tables).toHaveLength(1);
    db.close();
  });
});

describe("runMigrations", () => {
  it("works on in-memory database", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'")
      .all() as Array<{ name: string }>;
    expect(tables).toHaveLength(1);
    db.close();
  });
});
