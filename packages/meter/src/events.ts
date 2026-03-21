import { appendFileSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "@mecha/core";
import type { MeterEvent } from "./types.js";

const log = createLogger("mecha:meter");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Cache of directories already confirmed to exist (avoids repeated mkdirSync) */
const ensuredDirs = new Set<string>();

/** Get the UTC date string (YYYY-MM-DD) for an ISO timestamp */
export function utcDate(ts: string): string {
  return ts.slice(0, 10);
}

function validateDate(date: string): string {
  if (!DATE_RE.test(date)) {
    throw new Error(`Invalid date format: ${date}. Expected YYYY-MM-DD.`);
  }
  return date;
}

/** Get the events directory path */
export function eventsDir(meterDir: string): string {
  return join(meterDir, "events");
}

/** Append a MeterEvent to the day's JSONL file */
export function appendEvent(meterDir: string, event: MeterEvent): void {
  const dir = eventsDir(meterDir);
  if (!ensuredDirs.has(dir)) {
    mkdirSync(dir, { recursive: true });
    ensuredDirs.add(dir);
  }
  const file = join(dir, `${validateDate(utcDate(event.ts))}.jsonl`);
  appendFileSync(file, JSON.stringify(event) + "\n");
}

/** Read all events for a specific UTC date. Skips malformed lines. */
export function readEventsForDate(meterDir: string, date: string): MeterEvent[] {
  const file = join(eventsDir(meterDir), `${validateDate(date)}.jsonl`);
  try {
    const raw = readFileSync(file, "utf-8");
    const events: MeterEvent[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line) as MeterEvent);
      } catch {
        /* v8 ignore start -- malformed line in JSONL */
        log.warn("Skipping malformed line in event file", { date });
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

/**
 * Delete event files older than `retentionDays` days.
 * Returns the number of files deleted.
 */
export function cleanupOldEvents(meterDir: string, retentionDays: number): number {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);
  const cutoffDate = cutoff.toISOString().slice(0, 10);

  const dates = listEventDates(meterDir);
  let deleted = 0;
  for (const date of dates) {
    if (date < cutoffDate) {
      try {
        unlinkSync(join(eventsDir(meterDir), `${date}.jsonl`));
        deleted++;
      /* v8 ignore start -- race: file deleted between list and unlink */
      } catch {
        continue;
      }
      /* v8 ignore stop */
    }
  }
  return deleted;
}
