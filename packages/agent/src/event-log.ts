import { readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const EVENT_LOG_FILE = "events.jsonl";
const FILE_MODE = 0o600;

/** Severity level for system events. */
export type EventSeverity = "info" | "warn" | "error";
/** Category of system event source. */
export type EventCategory = "auth" | "process" | "server";

/** A persisted system event entry (auth, process lifecycle, server events). */
export interface SystemEvent {
  ts: string;
  severity: EventSeverity;
  category: EventCategory;
  event: string;
  message: string;
  meta?: Record<string, unknown>;
}

/** JSONL-backed append-only event log for system events. */
export interface EventLog {
  append(entry: SystemEvent): void;
  read(opts?: { limit?: number }): SystemEvent[];
  clear(): void;
}

/** Create a file-backed event log stored as JSONL in the mecha directory. */
export function createEventLog(mechaDir: string): EventLog {
  const filePath = join(mechaDir, EVENT_LOG_FILE);

  return {
    append(entry: SystemEvent): void {
      try {
        appendFileSync(filePath, JSON.stringify(entry) + "\n", { mode: FILE_MODE });
      /* v8 ignore start -- disk full / permission errors are runtime-only */
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[mecha] event-log write failed: ${msg}\n`);
      }
      /* v8 ignore stop */
    },

    read(opts?: { limit?: number }): SystemEvent[] {
      let content: string;
      try {
        content = readFileSync(filePath, "utf-8");
      /* v8 ignore start -- file may not exist yet */
      } catch {
        return [];
      }
      /* v8 ignore stop */
      const lines = content.trim().split("\n").filter(Boolean);
      const entries: SystemEvent[] = [];
      for (const line of lines) {
        try {
          entries.push(JSON.parse(line) as SystemEvent);
        /* v8 ignore start -- corrupt lines are runtime-only */
        } catch {
          // Skip corrupt JSONL lines
        }
        /* v8 ignore stop */
      }
      entries.reverse();
      if (opts?.limit && opts.limit > 0) return entries.slice(0, opts.limit);
      return entries;
    },

    clear(): void {
      writeFileSync(filePath, "", { mode: FILE_MODE });
    },
  };
}

/** Convenience helper for emitting events. */
export function emitEvent(
  log: EventLog,
  severity: EventSeverity,
  category: EventCategory,
  event: string,
  message: string,
  meta?: Record<string, unknown>,
): void {
  log.append({ ts: new Date().toISOString(), severity, category, event, message, meta });
}
