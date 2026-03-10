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

/** Index cache for O(1) rollup bucket lookups (lazily built per rollup instance) */
type HourBucket = HourlyRollup["hours"][number];
const hourlyIndexCache = new WeakMap<HourlyRollup, Map<number, HourBucket>>();

function getHourBucket(rollup: HourlyRollup, hour: number): HourBucket {
  let index = hourlyIndexCache.get(rollup);
  if (!index) {
    index = new Map();
    for (const h of rollup.hours) index.set(h.hour, h);
    hourlyIndexCache.set(rollup, index);
  }
  let bucket = index.get(hour);
  if (!bucket) {
    bucket = { hour, total: emptySummary(), byBot: {}, byModel: {} };
    rollup.hours.push(bucket);
    index.set(hour, bucket);
  }
  return bucket;
}

/** Update hourly rollup incrementally with a new event */
export function updateHourlyRollup(rollup: HourlyRollup, event: MeterEvent): void {
  const hour = new Date(event.ts).getUTCHours();
  const bucket = getHourBucket(rollup, hour);
  accumulateEvent(bucket.total, event);
  accumulateEvent(ensureMap(bucket.byBot, event.bot), event);
  accumulateEvent(ensureMap(bucket.byModel, event.modelActual || event.model), event);
}

type DayBucket = DailyRollup["days"][number];
const dailyIndexCache = new WeakMap<DailyRollup, Map<string, DayBucket>>();

function getDayBucket(rollup: DailyRollup, date: string): DayBucket {
  let index = dailyIndexCache.get(rollup);
  if (!index) {
    index = new Map();
    for (const d of rollup.days) index.set(d.date, d);
    dailyIndexCache.set(rollup, index);
  }
  let day = index.get(date);
  if (!day) {
    day = {
      date, total: emptySummary(),
      byBot: {}, byModel: {}, byAuthProfile: {}, byTag: {}, byWorkspace: {},
    };
    rollup.days.push(day);
    index.set(date, day);
  }
  return day;
}

/** Update daily rollup incrementally with a new event */
export function updateDailyRollup(rollup: DailyRollup, event: MeterEvent, date: string): void {
  const day = getDayBucket(rollup, date);
  accumulateEvent(day.total, event);
  accumulateEvent(ensureMap(day.byBot, event.bot), event);
  accumulateEvent(ensureMap(day.byModel, event.modelActual || event.model), event);
  accumulateEvent(ensureMap(day.byAuthProfile, event.authProfile), event);
  accumulateEvent(ensureMap(day.byWorkspace, event.workspace), event);
  for (const tag of new Set(event.tags)) {
    accumulateEvent(ensureMap(day.byTag, tag), event);
  }
}

type BotDayEntry = BotRollup["byDay"][number];
const botDayIndexCache = new WeakMap<BotRollup, Map<string, BotDayEntry>>();

function getBotDayEntry(rollup: BotRollup, date: string): BotDayEntry {
  let index = botDayIndexCache.get(rollup);
  if (!index) {
    index = new Map();
    for (const d of rollup.byDay) index.set(d.date, d);
    botDayIndexCache.set(rollup, index);
  }
  let entry = index.get(date);
  if (!entry) {
    entry = { date, summary: emptySummary() };
    rollup.byDay.push(entry);
    index.set(date, entry);
  }
  return entry;
}

/** Update per-bot rollup incrementally */
export function updateBotRollup(rollup: BotRollup, event: MeterEvent, date: string): void {
  accumulateEvent(rollup.allTime, event);
  accumulateEvent(ensureMap(rollup.byModel, event.modelActual || event.model), event);
  const dayEntry = getBotDayEntry(rollup, date);
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
