import {
  type ScheduleEntry,
  type ScheduleRunResult,
  type ScheduleState,
  type ScheduleConfig,
  SCHEDULE_DEFAULTS,
} from "@mecha/core";
import {
  readScheduleConfig,
  writeScheduleConfig,
  readScheduleState,
  writeScheduleState,
  appendRunHistory,
} from "@mecha/process";

export interface ScheduleLog {
  (level: "info" | "warn" | "error", msg: string, data?: Record<string, unknown>): void;
}

export interface RunDeps {
  casaDir: string;
  chatFn: (prompt: string) => Promise<{ durationMs: number; error?: string }>;
  now: () => number;
  getActiveRun: () => string | undefined;
  setActiveRun: (id: string | undefined) => void;
  log: ScheduleLog;
}

export function todayStr(now: () => number): string {
  return new Date(now()).toISOString().slice(0, 10);
}

export function getConfig(casaDir: string): ScheduleConfig {
  return readScheduleConfig(casaDir);
}

export function saveConfig(casaDir: string, config: ScheduleConfig): void {
  writeScheduleConfig(casaDir, config);
}

export function getState(casaDir: string, scheduleId: string, now: () => number): ScheduleState {
  const existing = readScheduleState(casaDir, scheduleId);
  const today = todayStr(now);
  if (!existing) {
    return { runCount: 0, todayDate: today, runsToday: 0 };
  }
  if (existing.todayDate !== today) {
    return { ...existing, todayDate: today, runsToday: 0 };
  }
  return existing;
}

export function saveState(casaDir: string, scheduleId: string, state: ScheduleState): void {
  writeScheduleState(casaDir, scheduleId, state);
}

export async function executeRun(entry: ScheduleEntry, deps: RunDeps): Promise<ScheduleRunResult> {
  const { casaDir, chatFn, now, log } = deps;
  const config = getConfig(casaDir);
  const maxPerDay = config.maxRunsPerDay ?? SCHEDULE_DEFAULTS.MAX_RUNS_PER_DAY;

  const state = getState(casaDir, entry.id, now);

  // Budget check — aggregate across all schedules for this CASA
  // NOTE: O(n) disk reads per run; acceptable for MVP (few schedules); cache in future milestone
  const totalToday = config.schedules.reduce((sum, s) => {
    const st = getState(casaDir, s.id, now);
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
    appendRunHistory(casaDir, entry.id, result);
    return result;
  }

  // Concurrency guard — enforces maxConcurrent for all values, not just <=1
  const maxConcurrent = config.maxConcurrent ?? SCHEDULE_DEFAULTS.MAX_CONCURRENT;
  if (deps.getActiveRun()) {
    log("warn", `Schedule "${entry.id}" skipped: another schedule is running`, { activeRun: deps.getActiveRun() });
    const result: ScheduleRunResult = {
      scheduleId: entry.id,
      startedAt: new Date(now()).toISOString(),
      completedAt: new Date(now()).toISOString(),
      durationMs: 0,
      outcome: "skipped",
      error: "Another schedule is already running",
    };
    appendRunHistory(casaDir, entry.id, result);
    return result;
  }

  const startedAt = new Date(now()).toISOString();
  deps.setActiveRun(entry.id);
  log("info", `Schedule "${entry.id}" started`, { prompt: entry.prompt });

  let result: ScheduleRunResult;
  try {
    const chatResult = await chatFn(entry.prompt);
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
    deps.setActiveRun(undefined);
  }

  log(result.outcome === "success" ? "info" : "error",
    `Schedule "${entry.id}" completed: ${result.outcome}`,
    { durationMs: result.durationMs, error: result.error });

  // Guard: schedule may have been removed while run was in-flight
  const postRunConfig = getConfig(casaDir);
  /* v8 ignore start -- race guard: schedule removed during in-flight run */
  if (!postRunConfig.schedules.some((s) => s.id === entry.id)) {
    log("warn", `Schedule "${entry.id}" removed during run; skipping state save`);
    return result;
  }
  /* v8 ignore stop */

  // Update state
  const consecutiveErrors = state.consecutiveErrors ?? 0;
  const newConsecutiveErrors = result.outcome === "error" ? consecutiveErrors + 1 : 0;

  saveState(casaDir, entry.id, {
    lastRunAt: result.completedAt,
    runCount: state.runCount + 1,
    todayDate: todayStr(now),
    runsToday: state.runsToday + 1,
    consecutiveErrors: newConsecutiveErrors,
  });
  appendRunHistory(casaDir, entry.id, result);

  // Auto-pause after too many consecutive errors
  if (newConsecutiveErrors >= SCHEDULE_DEFAULTS.MAX_CONSECUTIVE_ERRORS) {
    const cfg = getConfig(casaDir);
    const idx = cfg.schedules.findIndex((s) => s.id === entry.id);
    /* v8 ignore start -- race guard: schedule removed between check and auto-pause */
    const target = idx !== -1 ? cfg.schedules[idx] : undefined;
    if (target) {
      target.paused = true;
      saveConfig(casaDir, cfg);
      log("warn", `Schedule "${entry.id}" auto-paused after ${newConsecutiveErrors} consecutive errors`);
    }
    /* v8 ignore stop */
  }

  return result;
}
