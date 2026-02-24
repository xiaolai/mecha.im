import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  unlinkSync,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface SessionMeta {
  id: string;
  title: string;
  starred: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * A transcript event — any JSON object with a `type` field.
 * Matches the Claude Agent SDK's native transcript format:
 * - { type: "user", message: { role: "user", content: "..." }, timestamp, ... }
 * - { type: "assistant", message: { role: "assistant", content: [...] }, timestamp, ... }
 * - { type: "progress", data: { ... }, timestamp, ... }
 * - { type: "file-history-snapshot", snapshot: { ... }, ... }
 */
export interface TranscriptEvent {
  type: string;
  [key: string]: unknown;
}

export interface Session extends SessionMeta {
  events: TranscriptEvent[];
}

export interface CreateSessionOpts {
  title?: string;
}

export interface SessionManager {
  create(opts?: CreateSessionOpts): SessionMeta;
  list(): SessionMeta[];
  get(id: string): Promise<Session | undefined>;
  delete(id: string): boolean;
  rename(id: string, title: string): boolean;
  star(id: string, starred: boolean): boolean;
  appendEvent(id: string, event: TranscriptEvent): Promise<void>;
  isBusy(id: string): boolean;
  setBusy(id: string, busy: boolean): void;
}

interface StoredMeta {
  id: string;
  title: string;
  starred: boolean;
  createdAt: string;
  updatedAt: string;
}

export function createSessionManager(
  projectsDir: string,
): SessionManager {
  mkdirSync(projectsDir, { recursive: true });

  const busySessions = new Set<string>();

  function _metaPath(id: string): string {
    return join(projectsDir, `${id}.meta.json`);
  }

  function _transcriptPath(id: string): string {
    return join(projectsDir, `${id}.jsonl`);
  }

  function _readMeta(id: string): StoredMeta | undefined {
    const path = _metaPath(id);
    if (!existsSync(path)) return undefined;
    try {
      return JSON.parse(readFileSync(path, "utf-8")) as StoredMeta;
    } catch {
      return undefined;
    }
  }

  function _writeMeta(meta: StoredMeta): void {
    writeFileSync(_metaPath(meta.id), JSON.stringify(meta, null, 2) + "\n", "utf-8");
  }

  function create(opts?: CreateSessionOpts): SessionMeta {
    const id = randomUUID();
    const now = new Date().toISOString();
    const title = opts?.title ?? "";

    const meta: StoredMeta = { id, title, starred: false, createdAt: now, updatedAt: now };
    _writeMeta(meta);

    return { id, title, starred: false, createdAt: now, updatedAt: now };
  }

  function list(): SessionMeta[] {
    let files: string[];
    try {
      files = readdirSync(projectsDir);
    } catch {
      return [];
    }

    const metas: SessionMeta[] = [];
    for (const file of files) {
      if (!file.endsWith(".meta.json")) continue;
      const id = file.slice(0, -".meta.json".length);
      const meta = _readMeta(id);
      if (meta) {
        metas.push({
          id: meta.id,
          title: meta.title,
          starred: meta.starred,
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
        });
      }
    }

    // Sort by updatedAt DESC (most recent first)
    metas.sort((a, b) => {
      const cmp = b.updatedAt.localeCompare(a.updatedAt);
      if (cmp !== 0) return cmp;
      // Stable secondary sort by id for determinism
      return b.id.localeCompare(a.id);
    });

    return metas;
  }

  async function get(id: string): Promise<Session | undefined> {
    const meta = _readMeta(id);
    if (!meta) return undefined;

    const events = await _readTranscript(id);

    return {
      id: meta.id,
      title: meta.title,
      starred: meta.starred,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      events,
    };
  }

  function deleteSession(id: string): boolean {
    const metaPath = _metaPath(id);
    if (!existsSync(metaPath)) return false;

    unlinkSync(metaPath);

    const transcriptPath = _transcriptPath(id);
    if (existsSync(transcriptPath)) {
      unlinkSync(transcriptPath);
    }
    busySessions.delete(id);
    return true;
  }

  function rename(id: string, title: string): boolean {
    const meta = _readMeta(id);
    if (!meta) return false;

    meta.title = title;
    meta.updatedAt = new Date().toISOString();
    _writeMeta(meta);
    return true;
  }

  function star(id: string, starred: boolean): boolean {
    const meta = _readMeta(id);
    if (!meta) return false;

    meta.starred = starred;
    meta.updatedAt = new Date().toISOString();
    _writeMeta(meta);
    return true;
  }

  async function appendEvent(id: string, event: TranscriptEvent): Promise<void> {
    const meta = _readMeta(id);
    if (!meta) throw new Error(`Session not found: ${id}`);

    const transcriptPath = _transcriptPath(id);
    const line = JSON.stringify(event) + "\n";
    await appendFile(transcriptPath, line, "utf-8");

    meta.updatedAt = new Date().toISOString();
    _writeMeta(meta);
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

  async function _readTranscript(id: string): Promise<TranscriptEvent[]> {
    const path = _transcriptPath(id);
    if (!existsSync(path)) return [];

    const content = (await readFile(path, "utf-8")).trim();
    if (!content) return [];

    const events: TranscriptEvent[] = [];
    for (const line of content.split("\n")) {
      try {
        events.push(JSON.parse(line) as TranscriptEvent);
      } catch {
        // skip malformed transcript lines
      }
    }
    return events;
  }

  return {
    create,
    list,
    get,
    delete: deleteSession,
    rename,
    star,
    appendEvent,
    isBusy,
    setBusy,
  };
}
