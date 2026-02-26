import {
  type ScheduleEntry,
  type ScheduleRunResult,
  ScheduleNotFoundError,
  DuplicateScheduleError,
  InvalidIntervalError,
  parseInterval,
} from "@mecha/core";
import { readRunHistory, removeScheduleData } from "@mecha/process";
import {
  executeRun,
  getConfig,
  saveConfig,
  getState,
  saveState,
  type ScheduleLog,
  type RunDeps,
} from "./schedule-runner.js";

export type { ScheduleLog };

export interface ScheduleEngine {
  start(): void;
  stop(): void;
  addSchedule(entry: ScheduleEntry): void;
  removeSchedule(scheduleId: string): void;
  pauseSchedule(scheduleId?: string): void;
  resumeSchedule(scheduleId?: string): void;
  listSchedules(): ScheduleEntry[];
  getHistory(scheduleId: string, limit?: number): ScheduleRunResult[];
  triggerNow(scheduleId: string): Promise<ScheduleRunResult>;
}

export interface ChatFn {
  (prompt: string): Promise<{ durationMs: number; error?: string }>;
}

export interface CreateScheduleEngineOpts {
  casaDir: string;
  casaName: string;
  chatFn: ChatFn;
  now?: () => number;
  log?: ScheduleLog;
}

/* v8 ignore start -- default no-op logger */
const noopLog: ScheduleLog = () => {};
/* v8 ignore stop */

export function createScheduleEngine(opts: CreateScheduleEngineOpts): ScheduleEngine {
  const { casaDir, chatFn } = opts;
  const now = opts.now ?? Date.now;
  const log = opts.log ?? noopLog;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let running = false;
  let activeRun: string | undefined;

  const runDeps: RunDeps = {
    casaDir,
    chatFn,
    now,
    log,
    getActiveRun: () => activeRun,
    setActiveRun: (id) => { activeRun = id; },
  };

  function clearTimer(scheduleId: string): void {
    const timer = timers.get(scheduleId);
    /* v8 ignore start -- no-op when timer not found */
    if (timer) {
      clearTimeout(timer);
      timers.delete(scheduleId);
    }
    /* v8 ignore stop */
  }

  function armTimer(entry: ScheduleEntry): void {
    clearTimer(entry.id);
    /* v8 ignore start -- callers already check paused/running before calling armTimer */
    if (entry.paused || !running) return;
    /* v8 ignore stop */

    const state = getState(casaDir, entry.id, now);
    const delayMs = entry.trigger.intervalMs;

    let nextDelay: number;
    if (state.nextRunAt) {
      const nextTime = new Date(state.nextRunAt).getTime();
      const diff = nextTime - now();
      /* v8 ignore start -- diff <= 0 means timer already passed */
      nextDelay = diff > 0 ? diff : 0;
      /* v8 ignore stop */
    } else if (state.lastRunAt) {
      const elapsed = now() - new Date(state.lastRunAt).getTime();
      nextDelay = Math.max(0, delayMs - elapsed);
    } else {
      nextDelay = delayMs;
    }

    const nextRunAt = new Date(now() + nextDelay).toISOString();
    saveState(casaDir, entry.id, { ...state, nextRunAt });

    log("info", `Arming timer for "${entry.id}"`, { nextRunAt, delayMs: nextDelay });

    const timer = setTimeout(async () => {
      timers.delete(entry.id);
      /* v8 ignore start -- race guard: stop() called between arm and fire */
      if (!running) return;
      /* v8 ignore stop */

      // Re-read config in case it was modified
      const currentConfig = getConfig(casaDir);
      const currentEntry = currentConfig.schedules.find((s) => s.id === entry.id);
      /* v8 ignore start -- race guard: schedule removed/paused between arm and fire */
      if (!currentEntry || currentEntry.paused) return;
      /* v8 ignore stop */

      try {
        await executeRun(currentEntry, runDeps);
      /* v8 ignore start -- defensive: prevents unhandled rejection crash (e.g. ENOSPC) */
      } catch (err) {
        log("error", `Schedule "${entry.id}" unhandled error`, { error: err instanceof Error ? err.message : String(err) });
      }
      /* v8 ignore stop */

      // Schedule next (chained setTimeout, not setInterval — prevents overlap)
      /* v8 ignore start -- re-arm guard: check running + schedule still exists */
      if (running) {
        const freshConfig = getConfig(casaDir);
        const freshEntry = freshConfig.schedules.find((s) => s.id === entry.id);
        if (freshEntry && !freshEntry.paused) {
          armTimer(freshEntry);
        }
      }
      /* v8 ignore stop */
    }, nextDelay);

    timers.set(entry.id, timer);
  }

  return {
    start() {
      running = true;
      const config = getConfig(casaDir);
      log("info", `Starting scheduler: ${config.schedules.length} schedule(s)`);
      for (const entry of config.schedules) {
        if (!entry.paused) {
          armTimer(entry);
        }
      }
    },

    stop() {
      running = false;
      log("info", "Stopping scheduler");
      for (const [id] of timers) {
        clearTimer(id);
      }
    },

    addSchedule(entry: ScheduleEntry) {
      const config = getConfig(casaDir);
      if (config.schedules.some((s) => s.id === entry.id)) {
        throw new DuplicateScheduleError(entry.id);
      }

      // Validate interval
      const ms = parseInterval(entry.trigger.every);
      if (ms === undefined || ms !== entry.trigger.intervalMs) {
        throw new InvalidIntervalError(entry.trigger.every);
      }

      config.schedules.push(entry);
      saveConfig(casaDir, config);

      if (running && !entry.paused) {
        armTimer(entry);
      }
    },

    removeSchedule(scheduleId: string) {
      const config = getConfig(casaDir);
      const idx = config.schedules.findIndex((s) => s.id === scheduleId);
      if (idx === -1) throw new ScheduleNotFoundError(scheduleId);

      config.schedules.splice(idx, 1);
      saveConfig(casaDir, config);
      clearTimer(scheduleId);
      removeScheduleData(casaDir, scheduleId);
    },

    pauseSchedule(scheduleId?: string) {
      const config = getConfig(casaDir);
      if (scheduleId) {
        const entry = config.schedules.find((s) => s.id === scheduleId);
        if (!entry) throw new ScheduleNotFoundError(scheduleId);
        entry.paused = true;
        clearTimer(scheduleId);
      } else {
        for (const entry of config.schedules) {
          entry.paused = true;
          clearTimer(entry.id);
        }
      }
      saveConfig(casaDir, config);
    },

    resumeSchedule(scheduleId?: string) {
      const config = getConfig(casaDir);
      if (scheduleId) {
        const entry = config.schedules.find((s) => s.id === scheduleId);
        if (!entry) throw new ScheduleNotFoundError(scheduleId);
        entry.paused = false;
        if (running) armTimer(entry);
      } else {
        for (const entry of config.schedules) {
          entry.paused = false;
          /* v8 ignore start -- armTimer only when engine is running */
          if (running) armTimer(entry);
          /* v8 ignore stop */
        }
      }
      saveConfig(casaDir, config);
    },

    listSchedules() {
      return getConfig(casaDir).schedules;
    },

    getHistory(scheduleId: string, limit?: number) {
      const config = getConfig(casaDir);
      if (!config.schedules.some((s) => s.id === scheduleId)) {
        throw new ScheduleNotFoundError(scheduleId);
      }
      return readRunHistory(casaDir, scheduleId, limit);
    },

    async triggerNow(scheduleId: string) {
      const config = getConfig(casaDir);
      const entry = config.schedules.find((s) => s.id === scheduleId);
      if (!entry) throw new ScheduleNotFoundError(scheduleId);
      return executeRun(entry, runDeps);
    },
  };
}
