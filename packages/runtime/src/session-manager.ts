import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { join } from "node:path";

const MAX_TRANSCRIPT_BYTES = 10 * 1024 * 1024; // 10 MB safety cap

export interface SessionMeta {
  id: string;
  title: string;
  starred: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * A transcript event — any JSON object with a `type` field.
 * Written by Claude Code (Agent SDK) naturally during conversations.
 */
export interface TranscriptEvent {
  type: string;
  [key: string]: unknown;
}

export interface Session extends SessionMeta {
  events: TranscriptEvent[];
}

/** Read-only session manager — reads what Claude Code writes to the projects dir. */
export interface SessionManager {
  list(): SessionMeta[];
  get(id: string): Promise<Session | undefined>;
}

interface StoredMeta {
  id: string;
  title: string;
  starred: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Creates a read-only session manager that reads session files
 * written by Claude Code (Agent SDK) in the projects directory.
 */
/** Validate session ID — must be a simple slug (no path separators or traversal). */
function _validateId(id: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

export function createSessionManager(
  projectsDir: string,
): SessionManager {
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
    if (!_validateId(id)) return undefined;
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

  async function _readTranscript(id: string): Promise<TranscriptEvent[]> {
    const path = _transcriptPath(id);

    // Guard: reject missing or excessively large transcripts.
    // Using sync read eliminates the TOCTOU gap between stat and read.
    let content: string;
    try {
      const st = statSync(path);
      if (st.size > MAX_TRANSCRIPT_BYTES) return [];
      content = readFileSync(path, "utf-8").trim();
    } catch { return []; }
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
    list,
    get,
  };
}
