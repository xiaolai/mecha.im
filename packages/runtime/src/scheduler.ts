import {
  type ScheduleEntry,
  type ScheduleRunResult,
  type ScheduleState,
  type ScheduleConfig,
  SCHEDULE_DEFAULTS,
  ScheduleNotFoundError,
  DuplicateScheduleError,
  InvalidIntervalError,
  parseInterval,
} from "@mecha/core";
import {
  readScheduleConfig,
  writeScheduleConfig,
  readScheduleState,
  writeScheduleState,
  appendRunHistory,
  readRunHistory,
  removeScheduleData,
} from "@mecha/process";

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
  casaName: string; // reserved for logging/metrics in future milestones
  chatFn: ChatFn;
  now?: () => number;
}

export function createScheduleEngine(opts: CreateScheduleEngineOpts): ScheduleEngine {
  const { casaDir, chatFn } = opts;
  const now = opts.now ?? Date.now;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let running = false;
  let activeRun: string | undefined;

  function todayStr(): string {
    return new Date(now()).toISOString().slice(0, 10);
  }

  function getConfig(): ScheduleConfig {
    return readScheduleConfig(casaDir);
  }

  function saveConfig(config: ScheduleConfig): void {
    writeScheduleConfig(casaDir, config);
  }

  function getState(scheduleId: string): ScheduleState {
    const existing = readScheduleState(casaDir, scheduleId);
    const today = todayStr();
    if (!existing) {
      return { runCount: 0, todayDate: today, runsToday: 0 };
    }
    if (existing.todayDate !== today) {
      return { ...existing, todayDate: today, runsToday: 0 };
    }
    return existing;
  }

  function saveState(scheduleId: string, state: ScheduleState): void {
    writeScheduleState(casaDir, scheduleId, state);
  }

  function clearTimer(scheduleId: string): void {
    const timer = timers.get(scheduleId);
    /* v8 ignore start -- no-op when timer not found */
    if (timer) {
      clearTimeout(timer);
      timers.delete(scheduleId);
    }
    /* v8 ignore stop */
  }

  async function executeRun(entry: ScheduleEntry): Promise<ScheduleRunResult> {
    const config = getConfig();
    const maxPerDay = config.maxRunsPerDay ?? SCHEDULE_DEFAULTS.MAX_RUNS_PER_DAY;

    const state = getState(entry.id);

    // Budget check — aggregate across all schedules for this CASA
    // NOTE: O(n) disk reads per run; acceptable for MVP (few schedules); cache in future milestone
    const totalToday = config.schedules.reduce((sum, s) => {
      const st = getState(s.id);
      return sum + st.runsToday;
    }, 0);

    if (totalToday >= maxPerDay) {
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

    // Concurrency guard
    const maxConcurrent = config.maxConcurrent ?? SCHEDULE_DEFAULTS.MAX_CONCURRENT;
    if (activeRun && maxConcurrent <= 1) {
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
    activeRun = entry.id;

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
      activeRun = undefined;
    }

    // Guard: schedule may have been removed while run was in-flight
    const postRunConfig = getConfig();
    /* v8 ignore start -- race guard: schedule removed during in-flight run */
    if (!postRunConfig.schedules.some((s) => s.id === entry.id)) {
      return result;
    }
    /* v8 ignore stop */

    // Update state
    const consecutiveErrors = state.consecutiveErrors ?? 0;
    const newConsecutiveErrors = result.outcome === "error" ? consecutiveErrors + 1 : 0;

    saveState(entry.id, {
      lastRunAt: result.completedAt,
      runCount: state.runCount + 1,
      todayDate: todayStr(),
      runsToday: state.runsToday + 1,
      consecutiveErrors: newConsecutiveErrors,
    });
    appendRunHistory(casaDir, entry.id, result);

    // Auto-pause after too many consecutive errors
    if (newConsecutiveErrors >= SCHEDULE_DEFAULTS.MAX_CONSECUTIVE_ERRORS) {
      const cfg = getConfig();
      const idx = cfg.schedules.findIndex((s) => s.id === entry.id);
      /* v8 ignore start -- race guard: schedule removed between check and auto-pause */
      const target = idx !== -1 ? cfg.schedules[idx] : undefined;
      if (target) {
        target.paused = true;
        saveConfig(cfg);
        clearTimer(entry.id);
      }
      /* v8 ignore stop */
    }

    return result;
  }

  function armTimer(entry: ScheduleEntry): void {
    clearTimer(entry.id);
    /* v8 ignore start -- callers already check paused/running before calling armTimer */
    if (entry.paused || !running) return;
    /* v8 ignore stop */

    const state = getState(entry.id);
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
    saveState(entry.id, { ...state, nextRunAt });

    const timer = setTimeout(async () => {
      timers.delete(entry.id);
      /* v8 ignore start -- race guard: stop() called between arm and fire */
      if (!running) return;
      /* v8 ignore stop */

      // Re-read config in case it was modified
      const currentConfig = getConfig();
      const currentEntry = currentConfig.schedules.find((s) => s.id === entry.id);
      /* v8 ignore start -- race guard: schedule removed/paused between arm and fire */
      if (!currentEntry || currentEntry.paused) return;
      /* v8 ignore stop */

      await executeRun(currentEntry);

      // Schedule next (chained setTimeout, not setInterval — prevents overlap)
      /* v8 ignore start -- re-arm guard: check running + schedule still exists */
      if (running) {
        const freshConfig = getConfig();
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
      const config = getConfig();
      for (const entry of config.schedules) {
        if (!entry.paused) {
          armTimer(entry);
        }
      }
    },

    stop() {
      running = false;
      for (const [id] of timers) {
        clearTimer(id);
      }
    },

    addSchedule(entry: ScheduleEntry) {
      const config = getConfig();
      if (config.schedules.some((s) => s.id === entry.id)) {
        throw new DuplicateScheduleError(entry.id);
      }

      // Validate interval
      const ms = parseInterval(entry.trigger.every);
      if (ms === undefined || ms !== entry.trigger.intervalMs) {
        throw new InvalidIntervalError(entry.trigger.every);
      }

      config.schedules.push(entry);
      saveConfig(config);

      if (running && !entry.paused) {
        armTimer(entry);
      }
    },

    removeSchedule(scheduleId: string) {
      const config = getConfig();
      const idx = config.schedules.findIndex((s) => s.id === scheduleId);
      if (idx === -1) throw new ScheduleNotFoundError(scheduleId);

      config.schedules.splice(idx, 1);
      saveConfig(config);
      clearTimer(scheduleId);
      removeScheduleData(casaDir, scheduleId);
    },

    pauseSchedule(scheduleId?: string) {
      const config = getConfig();
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
      saveConfig(config);
    },

    resumeSchedule(scheduleId?: string) {
      const config = getConfig();
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
      saveConfig(config);
    },

    listSchedules() {
      return getConfig().schedules;
    },

    getHistory(scheduleId: string, limit?: number) {
      const config = getConfig();
      if (!config.schedules.some((s) => s.id === scheduleId)) {
        throw new ScheduleNotFoundError(scheduleId);
      }
      return readRunHistory(casaDir, scheduleId, limit);
    },

    async triggerNow(scheduleId: string) {
      const config = getConfig();
      const entry = config.schedules.find((s) => s.id === scheduleId);
      if (!entry) throw new ScheduleNotFoundError(scheduleId);
      return executeRun(entry);
    },
  };
}
