import { appendFileSync, mkdirSync, readFileSync, writeFileSync, watchFile, unwatchFile, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { ProcessEvent } from "./types.js";

const MAX_EVENTS = 1000;

/**
 * Append-only event log backed by a JSONL file.
 * Consumers can subscribe via `watch()` and receive new events.
 */
export class EventLog {
  constructor(private readonly filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true });
    if (!existsSync(filePath)) {
      writeFileSync(filePath, "");
    }
  }

  /** Append an event to the log. Auto-truncates when over MAX_EVENTS. */
  emit(event: ProcessEvent): void {
    appendFileSync(this.filePath, JSON.stringify(event) + "\n");
    this.truncateIfNeeded();
  }

  /** Read all events from the log. */
  readAll(): ProcessEvent[] {
    try {
      const raw = readFileSync(this.filePath, "utf-8").trim();
      if (!raw) return [];
      return raw.split("\n").map((line) => JSON.parse(line) as ProcessEvent);
    } catch {
      return [];
    }
  }

  /**
   * Watch for new events. Calls `handler` for each new event.
   * Returns an unsubscribe function.
   */
  watch(handler: (event: ProcessEvent) => void): () => void {
    let lastSize = this.getFileSize();

    /* v8 ignore start — fs.watchFile callback is timing-dependent */
    const listener = () => {
      const currentSize = this.getFileSize();
      if (currentSize <= lastSize) {
        lastSize = currentSize;
        return;
      }
      try {
        const raw = readFileSync(this.filePath, "utf-8");
        const lines = raw.trim().split("\n");
        const allEvents = lines
          .map((line) => {
            try {
              return JSON.parse(line) as ProcessEvent;
            } catch {
              return null;
            }
          })
          .filter((e): e is ProcessEvent => e !== null);

        const previousLines = raw.substring(0, lastSize).trim().split("\n").filter(Boolean);
        const newEvents = allEvents.slice(previousLines.length);
        for (const event of newEvents) {
          handler(event);
        }
      } catch {
        // file may be temporarily unavailable during truncation
      }
      lastSize = currentSize;
    };
    /* v8 ignore stop */

    watchFile(this.filePath, { interval: 500 }, listener);
    return () => {
      unwatchFile(this.filePath, listener);
    };
  }

  private getFileSize(): number {
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      return raw.length;
    } catch {
      return 0;
    }
  }

  private truncateIfNeeded(): void {
    try {
      const raw = readFileSync(this.filePath, "utf-8").trim();
      /* v8 ignore start -- empty file edge case */
      if (!raw) return;
      /* v8 ignore stop */
      const lines = raw.split("\n");
      if (lines.length > MAX_EVENTS) {
        const kept = lines.slice(lines.length - MAX_EVENTS);
        writeFileSync(this.filePath, kept.join("\n") + "\n");
      }
    } catch { /* v8 ignore next */
      // ignore truncation failures
    }
  }
}
