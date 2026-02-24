import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  appendFileSync,
  readFileSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import type { Database } from "better-sqlite3";

export interface SessionMeta {
  id: string;
  title: string;
  starred: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SessionMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface Session extends SessionMeta {
  messages: SessionMessage[];
}

export interface CreateSessionOpts {
  title?: string;
}

export interface SessionManager {
  create(opts?: CreateSessionOpts): SessionMeta;
  list(): SessionMeta[];
  get(id: string): Session | undefined;
  delete(id: string): boolean;
  rename(id: string, title: string): boolean;
  star(id: string, starred: boolean): boolean;
  appendMessage(id: string, msg: SessionMessage): void;
  isBusy(id: string): boolean;
  setBusy(id: string, busy: boolean): void;
}

export function createSessionManager(
  db: Database,
  transcriptDir: string,
): SessionManager {
  mkdirSync(transcriptDir, { recursive: true });

  const busySessions = new Set<string>();

  function create(opts?: CreateSessionOpts): SessionMeta {
    const id = randomUUID();
    const now = new Date().toISOString();
    const title = opts?.title ?? "";

    db.prepare(
      "INSERT INTO sessions (id, title, starred, created_at, updated_at) VALUES (?, ?, 0, ?, ?)",
    ).run(id, title, now, now);

    return { id, title, starred: false, createdAt: now, updatedAt: now };
  }

  function list(): SessionMeta[] {
    const rows = db
      .prepare(
        "SELECT id, title, starred, created_at, updated_at FROM sessions ORDER BY updated_at DESC, rowid DESC",
      )
      .all() as Array<{
      id: string;
      title: string;
      starred: number;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      starred: r.starred === 1,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  function get(id: string): Session | undefined {
    const row = db
      .prepare(
        "SELECT id, title, starred, created_at, updated_at FROM sessions WHERE id = ?",
      )
      .get(id) as
      | {
          id: string;
          title: string;
          starred: number;
          created_at: string;
          updated_at: string;
        }
      | undefined;

    if (!row) return undefined;

    const messages = _readTranscript(id);

    return {
      id: row.id,
      title: row.title,
      starred: row.starred === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messages,
    };
  }

  function deleteSession(id: string): boolean {
    const result = db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
    if (result.changes === 0) return false;

    const transcriptPath = _transcriptPath(id);
    if (existsSync(transcriptPath)) {
      unlinkSync(transcriptPath);
    }
    busySessions.delete(id);
    return true;
  }

  function rename(id: string, title: string): boolean {
    const now = new Date().toISOString();
    const result = db
      .prepare("UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?")
      .run(title, now, id);
    return result.changes > 0;
  }

  function star(id: string, starred: boolean): boolean {
    const now = new Date().toISOString();
    const result = db
      .prepare("UPDATE sessions SET starred = ?, updated_at = ? WHERE id = ?")
      .run(starred ? 1 : 0, now, id);
    return result.changes > 0;
  }

  function appendMessage(id: string, msg: SessionMessage): void {
    const transcriptPath = _transcriptPath(id);
    const line = JSON.stringify(msg) + "\n";
    appendFileSync(transcriptPath, line, "utf-8");

    const now = new Date().toISOString();
    db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(now, id);
  }

  function isBusy(id: string): boolean {
    return busySessions.has(id);
  }

  function setBusy(id: string, busy: boolean): void {
    if (busy) {
      busySessions.add(id);
    } else {
      busySessions.delete(id);
    }
  }

  function _transcriptPath(id: string): string {
    return join(transcriptDir, `${id}.jsonl`);
  }

  function _readTranscript(id: string): SessionMessage[] {
    const path = _transcriptPath(id);
    if (!existsSync(path)) return [];

    const content = readFileSync(path, "utf-8").trim();
    if (!content) return [];

    return content.split("\n").map((line) => JSON.parse(line) as SessionMessage);
  }

  return {
    create,
    list,
    get,
    delete: deleteSession,
    rename,
    star,
    appendMessage,
    isBusy,
    setBusy,
  };
}
