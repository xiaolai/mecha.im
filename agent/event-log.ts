import { readFileSync, statSync, renameSync, openSync, readSync, closeSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { PATHS } from "./paths.js";
import { log } from "../shared/logger.js";

export interface EventEntry {
  type: string;
  timestamp: string;
  [key: string]: unknown;
}

let writeFailureWarned = false;
let dirEnsured = false;

const MAX_LOG_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_ROTATED_FILES = 5;

function rotateIfNeeded(): void {
  try {
    const stats = statSync(PATHS.eventsLog);
    if (stats.size < MAX_LOG_BYTES) return;

    // Rotate: shift existing rotated files
    for (let i = MAX_ROTATED_FILES - 1; i >= 1; i--) {
      try {
        renameSync(`${PATHS.eventsLog}.${i}`, `${PATHS.eventsLog}.${i + 1}`);
      } catch { /* file may not exist */ }
    }
    renameSync(PATHS.eventsLog, `${PATHS.eventsLog}.1`);
  } catch {
    // File doesn't exist or can't stat — nothing to rotate
  }
}

export function logEvent(entry: { type: string; [key: string]: unknown }): void {
  const full: Record<string, unknown> = {
    ...entry,
    timestamp: new Date().toISOString(),
  };
  const line = JSON.stringify(full) + "\n";

  // Fire-and-forget async write (non-blocking)
  (async () => {
    try {
      if (!dirEnsured) {
        await mkdir(dirname(PATHS.eventsLog), { recursive: true });
        dirEnsured = true;
      }
      rotateIfNeeded();
      await appendFile(PATHS.eventsLog, line);
      writeFailureWarned = false;
    } catch (err) {
      if (!writeFailureWarned) {
        log.warn("event-log: write failed", { error: err instanceof Error ? err.message : String(err) });
        writeFailureWarned = true;
      }
    }
  })();
}

export function readEvents(limit = 100): EventEntry[] {
  const safeLimit = Math.max(1, Math.min(Number.isFinite(limit) ? Math.floor(limit) : 100, 1000));
  try {
    // Read only the tail of the file to avoid loading large files entirely into memory
    const stats = statSync(PATHS.eventsLog);
    const READ_TAIL_BYTES = 512 * 1024; // 512KB should cover any reasonable limit
    let raw: string;
    if (stats.size > READ_TAIL_BYTES) {
      const fd = openSync(PATHS.eventsLog, "r");
      try {
        const buf = Buffer.alloc(READ_TAIL_BYTES);
        readSync(fd, buf, 0, READ_TAIL_BYTES, stats.size - READ_TAIL_BYTES);
        raw = buf.toString("utf-8");
        // Drop the first (likely partial) line
        const firstNewline = raw.indexOf("\n");
        if (firstNewline !== -1) raw = raw.slice(firstNewline + 1);
      } finally {
        closeSync(fd);
      }
    } else {
      raw = readFileSync(PATHS.eventsLog, "utf-8");
    }
    const lines = raw.trimEnd().split("\n");
    const tail = lines.slice(-safeLimit);
    const entries: EventEntry[] = [];
    for (const line of tail) {
      if (!line) continue;
      try {
        entries.push(JSON.parse(line));
      } catch {
        // skip malformed lines
      }
    }
    return entries;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return []; // no events yet — expected
    log.warn("event-log: read failed", { error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}
