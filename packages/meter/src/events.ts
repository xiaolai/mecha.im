import { appendFileSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { MeterEvent } from "./types.js";

/** Get the UTC date string (YYYY-MM-DD) for an ISO timestamp */
export function utcDate(ts: string): string {
  return ts.slice(0, 10);
}

/** Get the events directory path */
export function eventsDir(meterDir: string): string {
  return join(meterDir, "events");
}

/** Append a MeterEvent to the day's JSONL file */
export function appendEvent(meterDir: string, event: MeterEvent): void {
  const dir = eventsDir(meterDir);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${utcDate(event.ts)}.jsonl`);
  appendFileSync(file, JSON.stringify(event) + "\n");
}

/** Read all events for a specific UTC date. Skips malformed lines. */
export function readEventsForDate(meterDir: string, date: string): MeterEvent[] {
  const file = join(eventsDir(meterDir), `${date}.jsonl`);
  try {
    const raw = readFileSync(file, "utf-8");
    const events: MeterEvent[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line) as MeterEvent);
      } catch {
        /* v8 ignore start -- malformed line in JSONL */
        console.error(`[mecha:meter] Skipping malformed line in ${date}.jsonl`);
        continue;
        /* v8 ignore stop */
      }
    }
    return events;
  } catch {
    return [];
  }
}

/** List available event dates (YYYY-MM-DD) sorted ascending */
export function listEventDates(meterDir: string): string[] {
  const dir = eventsDir(meterDir);
  try {
    return readdirSync(dir)
      .filter(f => f.endsWith(".jsonl"))
      .map(f => f.replace(".jsonl", ""))
      .sort();
  } catch {
    return [];
  }
}
