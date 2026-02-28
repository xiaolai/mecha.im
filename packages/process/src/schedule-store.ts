import {
  readFileSync,
  writeFileSync,
  renameSync,
  appendFileSync,
  mkdirSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  type ScheduleConfig,
  type ScheduleState,
  type ScheduleRunResult,
  ScheduleConfigSchema,
  ScheduleStateSchema,
  safeReadJson,
  createLogger,
} from "@mecha/core";

const log = createLogger("mecha:process");

// --- Atomic write helper ---

function atomicWrite(filePath: string, data: string): void {
  const dir = join(filePath, "..");
  mkdirSync(dir, { recursive: true });
  const tmp = filePath + `.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, data, "utf-8");
  renameSync(tmp, filePath);
}

// --- Schedule config (schedule.json) ---

const EMPTY_CONFIG: ScheduleConfig = { schedules: [] };

export function readScheduleConfig(casaDir: string): ScheduleConfig {
  const configPath = join(casaDir, "schedule.json");
  const result = safeReadJson(configPath, "schedule config", ScheduleConfigSchema);
  if (!result.ok) {
    /* v8 ignore start -- corrupt/unreadable config fallback */
    if (result.reason !== "missing") {
      log.error("Schedule config/state error", { detail: result.detail });
    }
    /* v8 ignore stop */
    return { ...EMPTY_CONFIG, schedules: [] };
  }
  return result.data;
}

export function writeScheduleConfig(casaDir: string, config: ScheduleConfig): void {
  atomicWrite(join(casaDir, "schedule.json"), JSON.stringify(config, null, 2) + "\n");
}

// --- Per-schedule state (schedules/<id>/state.json) ---

const SAFE_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

function scheduleDir(casaDir: string, scheduleId: string): string {
  if (!SAFE_ID_RE.test(scheduleId)) {
    throw new Error(`Invalid schedule ID: "${scheduleId}"`);
  }
  return join(casaDir, "schedules", scheduleId);
}

export function readScheduleState(casaDir: string, scheduleId: string): ScheduleState | undefined {
  const statePath = join(scheduleDir(casaDir, scheduleId), "state.json");
  const result = safeReadJson(statePath, `schedule "${scheduleId}" state`, ScheduleStateSchema);
  if (!result.ok) {
    /* v8 ignore start -- corrupt/unreadable state fallback */
    if (result.reason !== "missing") {
      log.error("Schedule config/state error", { detail: result.detail });
    }
    /* v8 ignore stop */
    return undefined;
  }
  return result.data;
}

export function writeScheduleState(casaDir: string, scheduleId: string, state: ScheduleState): void {
  atomicWrite(join(scheduleDir(casaDir, scheduleId), "state.json"), JSON.stringify(state, null, 2) + "\n");
}

// --- Run history (schedules/<id>/history.jsonl) ---

export function appendRunHistory(casaDir: string, scheduleId: string, result: ScheduleRunResult): void {
  const dir = scheduleDir(casaDir, scheduleId);
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, "history.jsonl"), JSON.stringify(result) + "\n", "utf-8");
}

export function readRunHistory(casaDir: string, scheduleId: string, limit?: number): ScheduleRunResult[] {
  const historyPath = join(scheduleDir(casaDir, scheduleId), "history.jsonl");
  if (!existsSync(historyPath)) return [];
  try {
    const raw = readFileSync(historyPath, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const results: ScheduleRunResult[] = [];
    for (const line of lines) {
      try {
        results.push(JSON.parse(line) as ScheduleRunResult);
      /* v8 ignore start -- skip malformed lines */
      } catch {
        continue;
      }
      /* v8 ignore stop */
    }
    if (limit !== undefined && limit > 0) {
      return results.slice(-limit);
    }
    return results;
  /* v8 ignore start -- corrupt file fallback */
  } catch (err) {
    log.error("Failed to read schedule history", { scheduleId, error: err instanceof Error ? err.message : String(err) });
    return [];
  }
  /* v8 ignore stop */
}

/** Remove all state and history for a schedule. */
export function removeScheduleData(casaDir: string, scheduleId: string): void {
  const dir = scheduleDir(casaDir, scheduleId);
  if (!existsSync(dir)) return;
  rmSync(dir, { recursive: true, force: true });
}
