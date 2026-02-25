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
});

const scheduleTriggerSchema = intervalTriggerSchema;

export const ScheduleEntrySchema = z.object({
  id: scheduleIdSchema,
  trigger: scheduleTriggerSchema,
  prompt: z.string().min(1),
  paused: z.boolean().optional(),
});
export type ScheduleEntry = z.infer<typeof ScheduleEntrySchema>;

export const ScheduleRunResultSchema = z.object({
  scheduleId: z.string(),
  startedAt: z.string(),
  completedAt: z.string(),
  durationMs: z.number(),
  outcome: z.enum(["success", "error", "skipped"]),
  error: z.string().optional(),
});
export type ScheduleRunResult = z.infer<typeof ScheduleRunResultSchema>;

export const ScheduleConfigSchema = z.object({
  schedules: z.array(ScheduleEntrySchema),
  maxRunsPerDay: z.number().int().positive().optional(),
  maxConcurrent: z.literal(1).optional(), // MVP: only 1 supported; extend when engine supports >1
});
export type ScheduleConfig = z.infer<typeof ScheduleConfigSchema>;

export const ScheduleStateSchema = z.object({
  nextRunAt: z.string().optional(),
  lastRunAt: z.string().optional(),
  runCount: z.number().int().nonnegative(),
  todayDate: z.string(),
  runsToday: z.number().int().nonnegative(),
  consecutiveErrors: z.number().int().nonnegative().optional(),
});
export type ScheduleState = z.infer<typeof ScheduleStateSchema>;

// --- Input schemas for CLI/HTTP ---

export const ScheduleAddInput = z.object({
  id: scheduleIdSchema,
  every: z.string().min(1),
  prompt: z.string().min(1),
});
export type ScheduleAddInput = z.infer<typeof ScheduleAddInput>;

// --- Defaults ---

export const SCHEDULE_DEFAULTS = {
  MAX_RUNS_PER_DAY: 50,
  MAX_CONCURRENT: 1,
  MAX_CONSECUTIVE_ERRORS: 5,
} as const;
