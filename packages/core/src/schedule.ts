import { z } from "zod";
import { NAME_PATTERN, NAME_MAX_LENGTH } from "./validation.js";

// --- Interval parsing ---

const INTERVAL_RE = /^(\d+)(s|m|h)$/;
const UNIT_MS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000 };
const MIN_INTERVAL_MS = 10_000; // 10 seconds minimum
const MAX_INTERVAL_MS = 86_400_000; // 24 hours maximum

/** Parse a human interval string ("5m", "1h", "30s") to milliseconds. Returns undefined on invalid input. */
export function parseInterval(input: string): number | undefined {
  const match = INTERVAL_RE.exec(input);
  if (!match) return undefined;
  const value = Number(match[1]);
  const unit = match[2] as string;
  if (value <= 0 || !unit) return undefined;
  /* v8 ignore start -- regex only captures keys in UNIT_MS */
  const ms = value * (UNIT_MS[unit] ?? 0);
  /* v8 ignore stop */
  if (ms < MIN_INTERVAL_MS || ms > MAX_INTERVAL_MS) return undefined;
  return ms;
}

// --- Cron expression parsing ---

const CRON_RE = /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)$/;

/** Parse a single cron field value. Returns matching values for the given range. */
function parseCronField(field: string, min: number, max: number): number[] {
  const values: number[] = [];
  for (const part of field.split(",")) {
    if (part === "*") {
      for (let i = min; i <= max; i++) values.push(i);
    } else if (part.includes("/")) {
      const [range, stepStr] = part.split("/");
      const step = Number(stepStr);
      const start = range === "*" ? min : Number(range);
      for (let i = start; i <= max; i += step) values.push(i);
    } else {
      values.push(Number(part));
    }
  }
  return values.filter((v) => v >= min && v <= max);
}

/** Check if a cron expression matches a given date. */
export function cronMatches(cron: string, date: Date): boolean {
  const match = CRON_RE.exec(cron);
  if (!match) return false;
  const minF = match[1]!;
  const hourF = match[2]!;
  const domF = match[3]!;
  const monF = match[4]!;
  const dowF = match[5]!;
  const minutes = parseCronField(minF, 0, 59);
  const hours = parseCronField(hourF, 0, 23);
  const doms = parseCronField(domF, 1, 31);
  const months = parseCronField(monF, 1, 12);
  const dows = parseCronField(dowF, 0, 6); // 0=Sunday

  return (
    minutes.includes(date.getMinutes()) &&
    hours.includes(date.getHours()) &&
    doms.includes(date.getDate()) &&
    months.includes(date.getMonth() + 1) &&
    dows.includes(date.getDay())
  );
}

/** Calculate milliseconds until the next cron match from now. Scans minute-by-minute up to 48h. */
export function nextCronMs(
  cron: string,
  from: Date = new Date(),
): number | undefined {
  const match = CRON_RE.exec(cron);
  if (!match) return undefined;

  // Start from next minute (floor to minute boundary)
  const check = new Date(from);
  check.setSeconds(0, 0);
  check.setMinutes(check.getMinutes() + 1);

  const maxMinutes = 48 * 60; // scan up to 48 hours
  for (let i = 0; i < maxMinutes; i++) {
    if (cronMatches(cron, check)) {
      return check.getTime() - from.getTime();
    }
    check.setMinutes(check.getMinutes() + 1);
  }
  /* v8 ignore start -- only reached if no match within 48h window */
  return undefined;
  /* v8 ignore stop */
}

/** Check if a string is a valid cron expression. */
export function isCronExpression(input: string): boolean {
  return CRON_RE.test(input.trim());
}

/** Parse a schedule expression (interval or cron). Returns type and a nextMs calculator, or undefined if invalid. */
export function parseScheduleExpression(
  expr: string,
):
  | { type: "interval" | "cron"; nextMs: (from?: Date) => number | undefined }
  | undefined {
  // Try interval first
  const intervalMs = parseInterval(expr);
  if (intervalMs != null) {
    return { type: "interval", nextMs: () => intervalMs };
  }
  // Try cron
  if (isCronExpression(expr)) {
    return {
      type: "cron",
      nextMs: (from?: Date) => nextCronMs(expr, from),
    };
  }
  return undefined;
}

// --- Zod schemas ---

const scheduleIdSchema = z
  .string()
  .min(1)
  .max(NAME_MAX_LENGTH)
  .regex(NAME_PATTERN, "Must be lowercase alphanumeric with hyphens");

const intervalTriggerSchema = z.object({
  type: z.literal("interval"),
  every: z.string().min(1),
  intervalMs: z.number().int().positive(),
}).refine(
  (t) => parseInterval(t.every) === t.intervalMs,
  { message: "intervalMs must match parsed value of every" },
);

const scheduleTriggerSchema = intervalTriggerSchema;

/** Zod schema for a single schedule entry (id, trigger, prompt). */
export const ScheduleEntrySchema = z.object({
  id: scheduleIdSchema,
  trigger: scheduleTriggerSchema,
  prompt: z.string().min(1),
  paused: z.boolean().optional(),
});
/** A single schedule entry defining when and what prompt to run. */
export type ScheduleEntry = z.infer<typeof ScheduleEntrySchema>;

/** Zod schema for a schedule run outcome record. */
export const ScheduleRunResultSchema = z.object({
  scheduleId: z.string(),
  startedAt: z.string(),
  completedAt: z.string(),
  durationMs: z.number(),
  outcome: z.enum(["success", "error", "skipped"]),
  error: z.string().optional(),
});
/** Outcome record of a single schedule run (success, error, or skipped). */
export type ScheduleRunResult = z.infer<typeof ScheduleRunResultSchema>;

/** Zod schema for the top-level schedule configuration (array of entries + limits). */
export const ScheduleConfigSchema = z.object({
  schedules: z.array(ScheduleEntrySchema),
  maxRunsPerDay: z.number().int().positive().optional(),
  maxConcurrent: z.literal(1).optional(), // MVP: only 1 supported; extend when engine supports >1
});
/** Top-level schedule configuration containing schedule entries and limits. */
export type ScheduleConfig = z.infer<typeof ScheduleConfigSchema>;

/** Zod schema for per-schedule execution state (next run, counts, errors). */
export const ScheduleStateSchema = z.object({
  nextRunAt: z.string().optional(),
  lastRunAt: z.string().optional(),
  runCount: z.number().int().nonnegative(),
  todayDate: z.string(),
  runsToday: z.number().int().nonnegative(),
  consecutiveErrors: z.number().int().nonnegative().optional(),
});
/** Per-schedule execution state tracking next run time, counts, and error streaks. */
export type ScheduleState = z.infer<typeof ScheduleStateSchema>;

// --- Input schemas for CLI/HTTP ---

/** Zod schema for CLI/HTTP schedule creation input. */
export const ScheduleAddInput = z.object({
  id: scheduleIdSchema,
  every: z.string().min(1),
  prompt: z.string().min(1),
});
/** Input type for adding a new schedule (id, interval, prompt). */
export type ScheduleAddInput = z.infer<typeof ScheduleAddInput>;

// --- Defaults ---

/** Default limits for schedule execution (max runs, concurrency, history). */
export const SCHEDULE_DEFAULTS = {
  MAX_RUNS_PER_DAY: 50,
  MAX_CONCURRENT: 1,
  MAX_CONSECUTIVE_ERRORS: 5,
  MAX_SCHEDULES_PER_BOT: 20,
  MAX_HISTORY_ENTRIES: 1000,
  RUN_TIMEOUT_MS: 600_000, // 10 minutes
} as const;
