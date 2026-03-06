import {
  type ScheduleEntry,
  type ScheduleRunResult,
  type ScheduleConfig,
  type ScheduleState,
  SCHEDULE_DEFAULTS,
} from "@mecha/core";
import {
  readScheduleConfig,
  writeScheduleConfig,
  readScheduleState,
  writeScheduleState,
  appendRunHistory,
} from "@mecha/process";

/** Structured logger callback for schedule engine events. */
export interface ScheduleLog {
  (level: "info" | "warn" | "error", msg: string, data?: Record<string, unknown>): void;
}

/** Dependencies injected into {@link executeRun} for testability. */
export interface RunDeps {
  botDir: string;
  chatFn: (prompt: string) => Promise<{ durationMs: number; error?: string }>;
  now: () => number;
  getActiveRun: () => string | undefined;
  setActiveRun: (id: string | undefined) => void;
  log: ScheduleLog;
  /** When true, skip budget/concurrency guards and don't count toward consecutiveErrors. */
  manual?: boolean;
}

/** Return today's date as an ISO date string (YYYY-MM-DD). */
export function todayStr(now: () => number): string {
  return new Date(now()).toISOString().slice(0, 10);
}

/** Read the schedule config from the bot's filesystem. */
export function getConfig(botDir: string): ScheduleConfig {
  return readScheduleConfig(botDir);
}

/** Persist the schedule config to the bot's filesystem. */
export function saveConfig(botDir: string, config: ScheduleConfig): void {
  writeScheduleConfig(botDir, config);
}

/** Read schedule run state, resetting daily counters if the date has changed. */
export function getState(botDir: string, scheduleId: string, now: () => number): ScheduleState {
  const existing = readScheduleState(botDir, scheduleId);
  const today = todayStr(now);
  if (!existing) {
    return { runCount: 0, todayDate: today, runsToday: 0 };
  }
  if (existing.todayDate !== today) {
    return { ...existing, todayDate: today, runsToday: 0 };
  }
  return existing;
}

/** Persist schedule run state to the bot's filesystem. */
export function saveState(botDir: string, scheduleId: string, state: ScheduleState): void {
  writeScheduleState(botDir, scheduleId, state);
}

/**
 * Execute a single scheduled run: enforce budget/concurrency, call chatFn, record result.
 * Auto-pauses the schedule after too many consecutive errors.
 */
export async function executeRun(entry: ScheduleEntry, deps: RunDeps): Promise<ScheduleRunResult> {
  const { botDir, chatFn, now, log, manual } = deps;
  const config = getConfig(botDir);
  const maxPerDay = config.maxRunsPerDay ?? SCHEDULE_DEFAULTS.MAX_RUNS_PER_DAY;

  const state = getState(botDir, entry.id, now);

  // Budget check — skip for manual triggers (operator-initiated)
  // NOTE: O(n) disk reads per run; acceptable for MVP (few schedules); cache in future milestone
  if (!manual) {
    const totalToday = config.schedules.reduce((sum, s) => {
      const st = getState(botDir, s.id, now);
      return sum + st.runsToday;
    }, 0);

    if (totalToday >= maxPerDay) {
      log("warn", `Schedule "${entry.id}" skipped: daily budget exceeded`, { maxPerDay, totalToday });
      const result: ScheduleRunResult = {
        scheduleId: entry.id,
        startedAt: new Date(now()).toISOString(),
        completedAt: new Date(now()).toISOString(),
        durationMs: 0,
        outcome: "skipped",
        error: `Daily budget exceeded (${maxPerDay} runs/day)`,
      };
      appendRunHistory(botDir, entry.id, result);
      return result;
    }
  }

  // Concurrency guard — skip for manual triggers
  if (!manual && deps.getActiveRun()) {
    log("warn", `Schedule "${entry.id}" skipped: another schedule is running`, { activeRun: deps.getActiveRun() });
    const result: ScheduleRunResult = {
      scheduleId: entry.id,
      startedAt: new Date(now()).toISOString(),
      completedAt: new Date(now()).toISOString(),
      durationMs: 0,
      outcome: "skipped",
      error: "Another schedule is already running",
    };
    appendRunHistory(botDir, entry.id, result);
    return result;
  }

  const startedAt = new Date(now()).toISOString();
  deps.setActiveRun(entry.id);
  log("info", `Schedule "${entry.id}" started`, { manual });

  let result: ScheduleRunResult;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    // Timeout guard — prevents a hanging chatFn from blocking the engine
    const timeoutMs = SCHEDULE_DEFAULTS.RUN_TIMEOUT_MS;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error(`Schedule run timed out after ${timeoutMs / 1000}s`)), timeoutMs);
    });
    const chatResult = await Promise.race([chatFn(entry.prompt), timeoutPromise]);
    const completedAt = new Date(now()).toISOString();

    if (chatResult.error) {
      result = {
        scheduleId: entry.id,
        startedAt,
        completedAt,
        durationMs: chatResult.durationMs,
        outcome: "error",
        error: chatResult.error,
      };
    } else {
      result = {
        scheduleId: entry.id,
        startedAt,
        completedAt,
        durationMs: chatResult.durationMs,
        outcome: "success",
      };
    }
  } catch (err) {
    const completedAt = new Date(now()).toISOString();
    result = {
      scheduleId: entry.id,
      startedAt,
      completedAt,
      durationMs: now() - new Date(startedAt).getTime(),
      outcome: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    deps.setActiveRun(undefined);
  }

  log(result.outcome === "success" ? "info" : "error",
    `Schedule "${entry.id}" completed: ${result.outcome}`,
    { durationMs: result.durationMs, error: result.error });

  // Guard: schedule may have been removed while run was in-flight
  const postRunConfig = getConfig(botDir);
  /* v8 ignore start -- race guard: schedule removed during in-flight run */
  if (!postRunConfig.schedules.some((s) => s.id === entry.id)) {
    log("warn", `Schedule "${entry.id}" removed during run; skipping state save`);
    return result;
  }
  /* v8 ignore stop */

  // Update state — manual triggers don't affect consecutiveErrors
  const consecutiveErrors = state.consecutiveErrors ?? 0;
  const newConsecutiveErrors = manual ? consecutiveErrors
    : result.outcome === "error" ? consecutiveErrors + 1 : 0;

  // Append history first (idempotent), then save state — crash-safe ordering
  appendRunHistory(botDir, entry.id, result);
  saveState(botDir, entry.id, {
    nextRunAt: undefined, // cleared — armTimer sets the next one
    lastRunAt: result.completedAt,
    runCount: state.runCount + 1,
    todayDate: todayStr(now),
    runsToday: state.runsToday + 1,
    consecutiveErrors: newConsecutiveErrors,
  });

  // Auto-pause after too many consecutive errors (not triggered by manual runs)
  if (!manual && newConsecutiveErrors >= SCHEDULE_DEFAULTS.MAX_CONSECUTIVE_ERRORS) {
    const cfg = getConfig(botDir);
    const idx = cfg.schedules.findIndex((s) => s.id === entry.id);
    /* v8 ignore start -- race guard: schedule removed between check and auto-pause */
    const target = idx !== -1 ? cfg.schedules[idx] : undefined;
    if (target) {
      target.paused = true;
      saveConfig(botDir, cfg);
      log("warn", `Schedule "${entry.id}" auto-paused after ${newConsecutiveErrors} consecutive errors`);
    }
    /* v8 ignore stop */
  }

  return result;
}
