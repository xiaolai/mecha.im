import { z } from "zod";
import { safeReadJson } from "../shared/safe-read.js";
import { atomicWriteJson } from "../shared/atomic-write.js";
import { log } from "../shared/logger.js";
import { PATHS } from "./paths.js";

const costsSchema = z.object({
  task: z.number().default(0),
  today: z.number().default(0),
  today_date: z.string().optional(),
  lifetime: z.number().default(0),
  daily: z.record(z.string(), z.number()).default({}),
});

type CostsData = z.infer<typeof costsSchema>;

const COSTS_PATH = PATHS.costs;

export class CostTracker {
  private data: CostsData;

  constructor() {
    const result = safeReadJson(COSTS_PATH, "costs", costsSchema);
    if (result.ok) {
      this.data = result.data;
    } else {
      if (result.reason !== "missing") {
        log.warn(`CostTracker: ${result.reason} — ${result.detail}. Reinitializing.`);
      }
      this.data = { task: 0, today: 0, lifetime: 0, daily: {} };
    }
    this.rolloverDay();
    this.pruneDailyEntries();
  }

  add(costUsd: number): void {
    if (!Number.isFinite(costUsd) || costUsd < 0) return;
    this.rolloverDay();
    this.data.task += costUsd;
    this.data.today += costUsd;
    this.data.lifetime += costUsd;

    const dateKey = this.todayKey();
    this.data.daily[dateKey] = (this.data.daily[dateKey] ?? 0) + costUsd;

    this.save();
  }

  resetTask(): void {
    this.data.task = 0;
    this.save();
  }

  getCosts(): { task: number; today: number; lifetime: number } {
    this.rolloverDay();
    return {
      task: this.data.task,
      today: this.data.today,
      lifetime: this.data.lifetime,
    };
  }

  private rolloverDay(): void {
    const today = this.todayKey();
    if (this.data.today_date !== today) {
      this.data.today = 0;
      this.data.today_date = today;
    }
  }

  private pruneDailyEntries(): void {
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const cutoffKey = cutoff.toISOString().slice(0, 10);
    let pruned = false;
    for (const key of Object.keys(this.data.daily)) {
      if (!datePattern.test(key) || key < cutoffKey) {
        delete this.data.daily[key];
        pruned = true;
      }
    }
    if (pruned) this.save();
  }

  private todayKey(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private save(): void {
    atomicWriteJson(COSTS_PATH, this.data);
  }
}
