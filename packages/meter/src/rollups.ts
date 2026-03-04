import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { createLogger } from "@mecha/core";
import type { MeterEvent, CostSummary, HourlyRollup, DailyRollup, BotRollup } from "./types.js";
import { emptySummary, accumulateEvent } from "./query.js";

const log = createLogger("mecha:meter");

// ── Path safety ─────────────────────────────────────────────────────

const SAFE_SEGMENT = /^[a-z0-9-]+$/;
const DATE_SEGMENT = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_SEGMENT = /^\d{4}-\d{2}$/;

function safePath(seg: string, pattern: RegExp): string {
  if (!pattern.test(seg)) throw new Error(`Invalid path segment: ${seg}`);
  return seg;
}

// ── Paths ──────────────────────────────────────────────────────────

export function hourlyRollupPath(meterDir: string, date: string): string {
  return join(meterDir, "rollups", "hourly", `${safePath(date, DATE_SEGMENT)}.json`);
}

export function dailyRollupPath(meterDir: string, month: string): string {
  return join(meterDir, "rollups", "daily", `${safePath(month, MONTH_SEGMENT)}.json`);
}

export function botRollupPath(meterDir: string, bot: string): string {
  return join(meterDir, "rollups", "bot", `${safePath(bot, SAFE_SEGMENT)}.json`);
}

// ── Generic read/write ───────────────────────────────────────────

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    /* v8 ignore start -- missing or corrupt rollup file */
    log.warn("Failed to read rollup, using empty", { path });
    return fallback;
    /* v8 ignore stop */
  }
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${Date.now()}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  renameSync(tmp, path);
}

// ── Read helpers ──────────────────────────────────────────────────

export function readHourlyRollup(meterDir: string, date: string): HourlyRollup {
  return readJson(hourlyRollupPath(meterDir, date), { date, hours: [] });
}

export function readDailyRollup(meterDir: string, month: string): DailyRollup {
  return readJson(dailyRollupPath(meterDir, month), { month, days: [] });
}

export function readBotRollup(meterDir: string, bot: string): BotRollup {
  return readJson(botRollupPath(meterDir, bot), { bot, allTime: emptySummary(), byModel: {}, byDay: [] });
}

// ── Write helpers ─────────────────────────────────────────────────

export function writeHourlyRollup(meterDir: string, rollup: HourlyRollup): void {
  writeJson(hourlyRollupPath(meterDir, rollup.date), rollup);
}

export function writeDailyRollup(meterDir: string, rollup: DailyRollup): void {
  writeJson(dailyRollupPath(meterDir, rollup.month), rollup);
}

export function writeBotRollup(meterDir: string, rollup: BotRollup): void {
  writeJson(botRollupPath(meterDir, rollup.bot), rollup);
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
    bucket = { hour, total: emptySummary(), byBot: {}, byModel: {} };
    rollup.hours.push(bucket);
  }
  accumulateEvent(bucket.total, event);
  accumulateEvent(ensureMap(bucket.byBot, event.bot), event);
  accumulateEvent(ensureMap(bucket.byModel, event.modelActual || event.model), event);
}

/** Update daily rollup incrementally with a new event */
export function updateDailyRollup(rollup: DailyRollup, event: MeterEvent, date: string): void {
  let day = rollup.days.find(d => d.date === date);
  if (!day) {
    day = {
      date, total: emptySummary(),
      byBot: {}, byModel: {}, byAuthProfile: {}, byTag: {}, byWorkspace: {},
    };
    rollup.days.push(day);
  }
  accumulateEvent(day.total, event);
  accumulateEvent(ensureMap(day.byBot, event.bot), event);
  accumulateEvent(ensureMap(day.byModel, event.modelActual || event.model), event);
  accumulateEvent(ensureMap(day.byAuthProfile, event.authProfile), event);
  accumulateEvent(ensureMap(day.byWorkspace, event.workspace), event);
  for (const tag of event.tags) {
    accumulateEvent(ensureMap(day.byTag, tag), event);
  }
}

/** Update per-bot rollup incrementally */
export function updateBotRollup(rollup: BotRollup, event: MeterEvent, date: string): void {
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
  bot: Map<string, BotRollup>,
): void {
  for (const rollup of hourly.values()) writeHourlyRollup(meterDir, rollup);
  for (const rollup of daily.values()) writeDailyRollup(meterDir, rollup);
  for (const rollup of bot.values()) writeBotRollup(meterDir, rollup);
}
