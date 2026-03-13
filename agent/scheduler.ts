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
  private onConfigChange?: (entries: ScheduleEntry[]) => void;

  constructor(
    entries: ScheduleEntry[],
    handler: PromptHandler,
    isBusy: () => boolean,
    onConfigChange?: (entries: ScheduleEntry[]) => void,
  ) {
    this.handler = handler;
    this.isBusy = isBusy;
    this.onConfigChange = onConfigChange;

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
    runCount: number;
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
      runCount: e.runCount,
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

  addEntry(cron: string, prompt: string): { id: string; error?: string } {
    // Validate cron
    try {
      new Cron(cron);
    } catch {
      return { id: "", error: `Invalid cron expression: "${cron}"` };
    }

    const id = stableId(cron, prompt);
    if (this.state.entries.find((e) => e.id === id)) {
      return { id, error: "Duplicate schedule entry (same cron + prompt)" };
    }

    const entry = {
      id,
      cron,
      prompt,
      status: "active" as const,
      nextRunAt: null as string | null,
      lastRunAt: null as string | null,
      runCount: 0,
      runsToday: 0,
      consecutiveErrors: 0,
      lastResult: null as string | null,
    };
    this.state.entries.push(entry);

    // Start cron job immediately
    const job = new Cron(cron, async () => { await this.fire(id); });
    this.jobs.set(id, job);
    entry.nextRunAt = job.nextRun()?.toISOString() ?? null;

    this.save();
    this.persistConfig();
    log.info(`Schedule entry added: "${id}" cron="${cron}"`);
    return { id };
  }

  updateEntry(entryId: string, updates: { cron?: string; prompt?: string }): { error?: string } {
    const entry = this.state.entries.find((e) => e.id === entryId);
    if (!entry) return { error: "Entry not found" };

    const newCron = updates.cron ?? entry.cron;
    const newPrompt = updates.prompt ?? entry.prompt;

    // Validate new cron if changed
    if (updates.cron) {
      try {
        new Cron(updates.cron);
      } catch {
        return { error: `Invalid cron expression: "${updates.cron}"` };
      }
    }

    // Stop old job
    const oldJob = this.jobs.get(entryId);
    if (oldJob) { oldJob.stop(); this.jobs.delete(entryId); }

    // Update entry (keep same id slot, recalculate id)
    const newId = stableId(newCron, newPrompt);
    entry.id = newId;
    entry.cron = newCron;
    entry.prompt = newPrompt;

    // Restart job if active
    if (entry.status === "active") {
      const job = new Cron(newCron, async () => { await this.fire(newId); });
      this.jobs.set(newId, job);
      entry.nextRunAt = job.nextRun()?.toISOString() ?? null;
    }

    this.save();
    this.persistConfig();
    log.info(`Schedule entry updated: "${entryId}" -> "${newId}"`);
    return {};
  }

  removeEntry(entryId: string): boolean {
    const idx = this.state.entries.findIndex((e) => e.id === entryId);
    if (idx === -1) return false;

    const job = this.jobs.get(entryId);
    if (job) { job.stop(); this.jobs.delete(entryId); }

    this.state.entries.splice(idx, 1);
    this.save();
    this.persistConfig();
    log.info(`Schedule entry removed: "${entryId}"`);
    return true;
  }

  pauseEntry(entryId: string): boolean {
    const entry = this.state.entries.find((e) => e.id === entryId);
    if (!entry || entry.status === "paused") return false;

    const job = this.jobs.get(entryId);
    if (job) { job.stop(); this.jobs.delete(entryId); }

    entry.status = "paused";
    entry.nextRunAt = null;
    this.save();
    log.info(`Schedule entry paused: "${entryId}"`);
    return true;
  }

  resumeEntry(entryId: string): { error?: string } {
    const entry = this.state.entries.find((e) => e.id === entryId);
    if (!entry) return { error: "Entry not found" };
    if (entry.status === "active") return { error: "Already active" };

    try {
      const job = new Cron(entry.cron, async () => { await this.fire(entryId); });
      this.jobs.set(entryId, job);
      entry.status = "active";
      entry.consecutiveErrors = 0;
      entry.nextRunAt = job.nextRun()?.toISOString() ?? null;
      this.save();
      log.info(`Schedule entry resumed: "${entryId}"`);
      return {};
    } catch {
      return { error: `Invalid cron expression: "${entry.cron}"` };
    }
  }

  private persistConfig(): void {
    const entries = this.state.entries.map((e) => ({ cron: e.cron, prompt: e.prompt }));
    this.onConfigChange?.(entries);
  }

  private save(): void {
    atomicWriteJson(STATE_PATH, this.state);
  }

  private async saveAsync(): Promise<void> {
    await atomicWriteJsonAsync(STATE_PATH, this.state);
  }
}
