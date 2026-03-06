import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { DEFAULTS, createLogger } from "@mecha/core";

const log = createLogger("mecha:runtime");

/** Lightweight session metadata (no transcript events). */
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

/** Full session including metadata and transcript events. */
export interface Session extends SessionMeta {
  events: TranscriptEvent[];
}

/** Session manager — reads what Claude Code writes to the projects dir. */
export interface SessionManager {
  list(): SessionMeta[];
  get(id: string): Promise<Session | undefined>;
  /** Delete a session's meta and transcript files. Returns true if anything was removed. */
  delete(id: string): boolean;
}

interface StoredMeta {
  id: string;
  title: string;
  starred: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Validate session ID — must be a simple slug (no path separators or traversal). */
function _validateId(id: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

/**
 * Create a read-only session manager that reads session files
 * written by Claude Code (Agent SDK) in the projects directory.
 */
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
      const raw = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
      // Validate required fields to prevent corrupt metadata from crashing sort/display
      if (
        typeof raw.id !== "string" ||
        typeof raw.title !== "string" ||
        typeof raw.createdAt !== "string" ||
        typeof raw.updatedAt !== "string"
      ) {
        log.warn("Invalid session metadata shape", { path });
        return undefined;
      }
      return {
        id: raw.id,
        title: raw.title,
        starred: typeof raw.starred === "boolean" ? raw.starred : false,
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
      };
    } catch {
      log.warn("Corrupt session metadata", { path });
      return undefined;
    }
  }

  function list(): SessionMeta[] {
    let files: string[];
    try {
      files = readdirSync(projectsDir);
    /* v8 ignore start -- directory read failure fallback */
    } catch (err) {
      log.error("Failed to read sessions directory", { error: err instanceof Error ? err.message : String(err) });
      return [];
    }
    /* v8 ignore stop */

    const metas: SessionMeta[] = [];
    const seenIds = new Set<string>();

    // First pass: sessions with .meta.json (full metadata)
    for (const file of files) {
      if (!file.endsWith(".meta.json")) continue;
      const id = file.slice(0, -".meta.json".length);
      const meta = _readMeta(id);
      if (meta) {
        seenIds.add(id);
        metas.push({
          id: meta.id,
          title: meta.title,
          starred: meta.starred,
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
        });
      }
    }

    // Second pass: .jsonl files with no corresponding .meta.json
    // Claude Code creates .jsonl immediately but .meta.json only later.
    // Synthesize minimal metadata so active sessions are visible immediately.
    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      const id = file.slice(0, -".jsonl".length);
      if (seenIds.has(id)) continue;
      if (!_validateId(id)) continue;
      try {
        const st = statSync(join(projectsDir, file));
        metas.push({
          id,
          title: "(active session)",
          starred: false,
          createdAt: st.birthtime.toISOString(),
          updatedAt: st.mtime.toISOString(),
        });
      /* v8 ignore start -- stat failure for orphan .jsonl */
      } catch {
        // Skip files we can't stat
      }
      /* v8 ignore stop */
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
    let meta = _readMeta(id);

    // Support .jsonl-only sessions (synthesize metadata like list() does)
    if (!meta && existsSync(_transcriptPath(id))) {
      try {
        const st = statSync(_transcriptPath(id));
        meta = {
          id,
          title: "(active session)",
          starred: false,
          createdAt: st.birthtime.toISOString(),
          updatedAt: st.mtime.toISOString(),
        };
      /* v8 ignore start -- stat failure for orphan .jsonl in get() */
      } catch {
        return undefined;
      }
      /* v8 ignore stop */
    }

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
    // stat + read are separate syscalls (small TOCTOU window), but acceptable for local-first use.
    let content: string;
    try {
      const st = statSync(path);
      if (st.size > DEFAULTS.MAX_TRANSCRIPT_BYTES) return [];
      content = readFileSync(path, "utf-8").trim();
    /* v8 ignore start -- IO error reading transcript file */
    } catch (err) {
      log.error("Failed to read transcript", { error: err instanceof Error ? err.message : String(err) });
      return [];
    }
    /* v8 ignore stop */
    if (!content) return [];

    const events: TranscriptEvent[] = [];
    for (const line of content.split("\n")) {
      try {
        events.push(JSON.parse(line) as TranscriptEvent);
      /* v8 ignore start -- malformed transcript line logging */
      } catch (err) {
        // Log malformed transcript lines for debugging
        log.warn("Malformed transcript line in session", { error: err instanceof Error ? err.message : String(err) });
      }
      /* v8 ignore stop */
    }
    return events;
  }

  function del(id: string): boolean {
    if (!_validateId(id)) return false;
    let removed = false;
    for (const path of [_metaPath(id), _transcriptPath(id)]) {
      try {
        unlinkSync(path);
        removed = true;
      } catch (err: unknown) {
        // ENOENT is expected (file may not exist); surface other errors
        /* v8 ignore start -- non-ENOENT errors are rare filesystem failures */
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          log.error("Failed to delete session file", { path, error: (err as Error).message });
        }
        /* v8 ignore stop */
      }
    }
    return removed;
  }

  return {
    list,
    get,
    delete: del,
  };
}
