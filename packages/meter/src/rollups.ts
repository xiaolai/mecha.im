import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { MeterEvent, CostSummary, HourlyRollup, DailyRollup, CasaRollup } from "./types.js";
import { emptySummary, accumulateEvent } from "./query.js";

// ── Paths ──────────────────────────────────────────────────────────

export function hourlyRollupPath(meterDir: string, date: string): string {
  return join(meterDir, "rollups", "hourly", `${date}.json`);
}

export function dailyRollupPath(meterDir: string, month: string): string {
  return join(meterDir, "rollups", "daily", `${month}.json`);
}

export function casaRollupPath(meterDir: string, casa: string): string {
  return join(meterDir, "rollups", "casa", `${casa}.json`);
}

// ── Generic read/write ───────────────────────────────────────────

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    /* v8 ignore start -- missing or corrupt rollup file */
    console.error(`[mecha:meter] Failed to read ${path}, using empty rollup`);
    return fallback;
    /* v8 ignore stop */
  }
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

// ── Read helpers ──────────────────────────────────────────────────

export function readHourlyRollup(meterDir: string, date: string): HourlyRollup {
  return readJson(hourlyRollupPath(meterDir, date), { date, hours: [] });
}

export function readDailyRollup(meterDir: string, month: string): DailyRollup {
  return readJson(dailyRollupPath(meterDir, month), { month, days: [] });
}

export function readCasaRollup(meterDir: string, casa: string): CasaRollup {
  return readJson(casaRollupPath(meterDir, casa), { casa, allTime: emptySummary(), byModel: {}, byDay: [] });
}

// ── Write helpers ─────────────────────────────────────────────────

export function writeHourlyRollup(meterDir: string, rollup: HourlyRollup): void {
  writeJson(hourlyRollupPath(meterDir, rollup.date), rollup);
}

export function writeDailyRollup(meterDir: string, rollup: DailyRollup): void {
  writeJson(dailyRollupPath(meterDir, rollup.month), rollup);
}

export function writeCasaRollup(meterDir: string, rollup: CasaRollup): void {
  writeJson(casaRollupPath(meterDir, rollup.casa), rollup);
}

// ── Incremental update ──────────────────────────────────────────

function ensureMap(map: Record<string, CostSummary>, key: string): CostSummary {
  if (!map[key]) map[key] = emptySummary();
  return map[key]!;
}

/** Update hourly rollup incrementally with a new event */
export function updateHourlyRollup(rollup: HourlyRollup, event: MeterEvent): void {
  const hour = new Date(event.ts).getUTCHours();
  let bucket = rollup.hours.find(h => h.hour === hour);
  if (!bucket) {
    bucket = { hour, total: emptySummary(), byCasa: {}, byModel: {} };
    rollup.hours.push(bucket);
  }
  accumulateEvent(bucket.total, event);
  accumulateEvent(ensureMap(bucket.byCasa, event.casa), event);
  accumulateEvent(ensureMap(bucket.byModel, event.modelActual || event.model), event);
}

/** Update daily rollup incrementally with a new event */
export function updateDailyRollup(rollup: DailyRollup, event: MeterEvent, date: string): void {
  let day = rollup.days.find(d => d.date === date);
  if (!day) {
    day = {
      date, total: emptySummary(),
      byCasa: {}, byModel: {}, byAuthProfile: {}, byTag: {}, byWorkspace: {},
    };
    rollup.days.push(day);
  }
  accumulateEvent(day.total, event);
  accumulateEvent(ensureMap(day.byCasa, event.casa), event);
  accumulateEvent(ensureMap(day.byModel, event.modelActual || event.model), event);
  accumulateEvent(ensureMap(day.byAuthProfile, event.authProfile), event);
  accumulateEvent(ensureMap(day.byWorkspace, event.workspace), event);
  for (const tag of event.tags) {
    accumulateEvent(ensureMap(day.byTag, tag), event);
  }
}

/** Update per-CASA rollup incrementally */
export function updateCasaRollup(rollup: CasaRollup, event: MeterEvent, date: string): void {
  accumulateEvent(rollup.allTime, event);
  accumulateEvent(ensureMap(rollup.byModel, event.modelActual || event.model), event);
  let dayEntry = rollup.byDay.find(d => d.date === date);
  if (!dayEntry) {
    dayEntry = { date, summary: emptySummary() };
    rollup.byDay.push(dayEntry);
  }
  accumulateEvent(dayEntry.summary, event);
}

/** Flush all in-memory rollups to disk */
export function flushRollups(
  meterDir: string,
  hourly: Map<string, HourlyRollup>,
  daily: Map<string, DailyRollup>,
  casa: Map<string, CasaRollup>,
): void {
  for (const rollup of hourly.values()) writeHourlyRollup(meterDir, rollup);
  for (const rollup of daily.values()) writeDailyRollup(meterDir, rollup);
  for (const rollup of casa.values()) writeCasaRollup(meterDir, rollup);
}
