import { Cron } from "croner";
import { createHash } from "node:crypto";
import { atomicWriteJson, atomicWriteJsonAsync } from "../shared/atomic-write.js";
import { safeReadJson } from "../shared/safe-read.js";
import { Mutex } from "../shared/mutex.js";
import { log } from "../shared/logger.js";
import { PATHS } from "./paths.js";
import { z } from "zod";

const MAX_RUNS_PER_DAY = 50;
const MAX_CONSECUTIVE_ERRORS = 5;
const RUN_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

interface ScheduleEntry {
  cron: string;
  prompt: string;
}

const scheduleStateSchema = z.object({
  entries: z.array(z.object({
    id: z.string(),
    cron: z.string(),
    prompt: z.string(),
    status: z.enum(["active", "paused"]).default("active"),
    nextRunAt: z.string().nullable().default(null),
    lastRunAt: z.string().nullable().default(null),
    runCount: z.number().default(0),
    runsToday: z.number().default(0),
    runsToday_date: z.string().optional(),
    consecutiveErrors: z.number().default(0),
    lastResult: z.enum(["success", "error", "skipped"]).nullable().default(null),
  })).default([]),
});

type ScheduleState = z.infer<typeof scheduleStateSchema>;

const STATE_PATH = PATHS.scheduleState;

export type PromptHandler = (prompt: string) => Promise<void>;

function stableId(cron: string, prompt: string): string {
  return createHash("sha256").update(`${cron}::${prompt}`).digest("hex").slice(0, 16);
}

export class Scheduler {
  private jobs = new Map<string, Cron>();
  private state: ScheduleState;
  private handler: PromptHandler;
  private isBusy: () => boolean;
  private stateMutex = new Mutex();

  constructor(
    entries: ScheduleEntry[],
    handler: PromptHandler,
    isBusy: () => boolean,
  ) {
    this.handler = handler;
    this.isBusy = isBusy;

    const result = safeReadJson(STATE_PATH, "schedule state", scheduleStateSchema);
    this.state = result.ok ? result.data : { entries: [] };

    // Sync entries from config
    for (const entry of entries) {
      const id = stableId(entry.cron, entry.prompt);
      const existing = this.state.entries.find((e) => e.id === id);
      if (!existing) {
        this.state.entries.push({
          id,
          cron: entry.cron,
          prompt: entry.prompt,
          status: "active",
          nextRunAt: null,
          lastRunAt: null,
          runCount: 0,
          runsToday: 0,
          consecutiveErrors: 0,
          lastResult: null,
        });
      }
    }
    this.save();
  }

  start(): void {
    for (const entry of this.state.entries) {
      if (entry.status !== "active") continue;

      try {
        const job = new Cron(entry.cron, async () => {
          await this.fire(entry.id);
        });
        this.jobs.set(entry.id, job);
        entry.nextRunAt = job.nextRun()?.toISOString() ?? null;
      } catch (err) {
        log.error(`Scheduler: invalid cron "${entry.cron}" for "${entry.id}"`, { error: err instanceof Error ? err.message : String(err) });
        entry.status = "paused";
        entry.lastResult = "error";
      }
    }
    this.save();
    log.info(`Scheduler started: ${this.jobs.size} job(s)`);
  }

  stop(): void {
    for (const job of this.jobs.values()) {
      job.stop();
    }
    this.jobs.clear();
    log.info("Scheduler stopped");
  }

  private async fire(entryId: string, opts?: { skipDailyLimit?: boolean }): Promise<void> {
    // Phase 1: pre-flight checks under mutex
    let release = await this.stateMutex.acquire();
    let entry: (typeof this.state.entries)[number] | undefined;
    try {
      entry = this.state.entries.find((e) => e.id === entryId);
      if (!entry) return;

      // Rollover daily counter
      const today = new Date().toISOString().slice(0, 10);
      if (entry.runsToday_date !== today) {
        entry.runsToday = 0;
        entry.runsToday_date = today;
      }

      // Safety: daily limit (skippable for manual triggers)
      if (!opts?.skipDailyLimit && entry.runsToday >= MAX_RUNS_PER_DAY) {
        entry.lastResult = "skipped";
        this.save();
        log.info(`Schedule "${entry.id}": skipped (daily limit)`);
        return;
      }

      // Safety: consecutive errors
      if (entry.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        entry.status = "paused";
        this.save();
        log.warn(`Schedule "${entry.id}": auto-paused after ${MAX_CONSECUTIVE_ERRORS} consecutive errors`);
        return;
      }

      // Busy check
      if (this.isBusy()) {
        entry.lastResult = "skipped";
        this.save();
        log.info(`Schedule "${entry.id}": skipped (busy)`);
        return;
      }

      entry.lastRunAt = new Date().toISOString();
      entry.runCount++;
      entry.runsToday++;
      await this.saveAsync();
    } finally {
      release();
    }

    if (!entry) return;

    // Phase 2: execute handler (long-running, no mutex held)
    let handlerSuccess = false;
    let handlerError: string | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.handler(entry.prompt),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Schedule run timeout")), RUN_TIMEOUT_MS);
        }),
      ]);
      handlerSuccess = true;
    } catch (err) {
      handlerError = err instanceof Error ? err.message : String(err);
    } finally {
      if (timer) clearTimeout(timer);
    }

    // Phase 3: post-handler state update under mutex
    release = await this.stateMutex.acquire();
    try {
      if (handlerSuccess) {
        entry.consecutiveErrors = 0;
        entry.lastResult = "success";
      } else {
        entry.consecutiveErrors++;
        entry.lastResult = "error";
        log.error(`Schedule "${entry.id}" error`, { error: handlerError });
      }
      const job = this.jobs.get(entry.id);
      if (job) {
        entry.nextRunAt = job.nextRun()?.toISOString() ?? null;
      }
      await this.saveAsync();
    } finally {
      release();
    }
  }

  getStatus(): Array<{
    id: string;
    cron: string;
    prompt: string;
    status: string;
    nextRunAt: string | null;
    lastRunAt: string | null;
    lastResult: string | null;
    runsToday: number;
    consecutiveErrors: number;
  }> {
    return this.state.entries.map((e) => ({
      id: e.id,
      cron: e.cron,
      prompt: e.prompt,
      status: e.status,
      nextRunAt: e.nextRunAt,
      lastRunAt: e.lastRunAt,
      lastResult: e.lastResult,
      runsToday: e.runsToday,
      consecutiveErrors: e.consecutiveErrors,
    }));
  }

  async triggerNow(entryId: string): Promise<boolean> {
    const entry = this.state.entries.find((e) => e.id === entryId);
    if (!entry) return false;
    await this.fire(entryId, { skipDailyLimit: true });
    return true;
  }

  private save(): void {
    atomicWriteJson(STATE_PATH, this.state);
  }

  private async saveAsync(): Promise<void> {
    await atomicWriteJsonAsync(STATE_PATH, this.state);
  }
}
