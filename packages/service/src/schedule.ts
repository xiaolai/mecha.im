import {
  type BotName,
  type ScheduleEntry,
  type ScheduleRunResult,
  parseInterval,
  InvalidIntervalError,
} from "@mecha/core";
import type { ProcessManager } from "@mecha/process";
import { runtimeFetch, assertOk } from "./helpers.js";

/** Add a scheduled prompt to a bot's runtime. Validates the interval client-side first. */
export async function botScheduleAdd(
  pm: ProcessManager,
  name: BotName,
  opts: { id: string; every: string; prompt: string },
): Promise<void> {
  // Validate interval client-side for fast feedback
  const ms = parseInterval(opts.every);
  if (ms === undefined) throw new InvalidIntervalError(opts.every);

  const result = await runtimeFetch(pm, name, "/api/schedules", {
    method: "POST",
    body: { id: opts.id, every: opts.every, prompt: opts.prompt },
  });
  assertOk(result, "SCHEDULE_ADD_FAILED");
}

/** Remove a schedule entry from a bot by schedule ID. */
export async function botScheduleRemove(
  pm: ProcessManager,
  name: BotName,
  scheduleId: string,
): Promise<void> {
  const result = await runtimeFetch(pm, name, `/api/schedules/${encodeURIComponent(scheduleId)}`, {
    method: "DELETE",
  });
  assertOk(result, "SCHEDULE_REMOVE_FAILED");
}

/** List all schedule entries for a bot. */
export async function botScheduleList(
  pm: ProcessManager,
  name: BotName,
): Promise<ScheduleEntry[]> {
  const result = await runtimeFetch(pm, name, "/api/schedules");
  assertOk(result, "SCHEDULE_LIST_FAILED");
  return result.body as ScheduleEntry[];
}

/** Pause a single schedule or all schedules for a bot. */
export async function botSchedulePause(
  pm: ProcessManager,
  name: BotName,
  scheduleId?: string,
): Promise<void> {
  const path = scheduleId
    ? `/api/schedules/${encodeURIComponent(scheduleId)}/pause`
    : "/api/schedules/_pause-all";
  const result = await runtimeFetch(pm, name, path, { method: "POST" });
  assertOk(result, "SCHEDULE_PAUSE_FAILED");
}

/** Resume a single schedule or all schedules for a bot. */
export async function botScheduleResume(
  pm: ProcessManager,
  name: BotName,
  scheduleId?: string,
): Promise<void> {
  const path = scheduleId
    ? `/api/schedules/${encodeURIComponent(scheduleId)}/resume`
    : "/api/schedules/_resume-all";
  const result = await runtimeFetch(pm, name, path, { method: "POST" });
  assertOk(result, "SCHEDULE_RESUME_FAILED");
}

/** Trigger an immediate run of a schedule entry. */
export async function botScheduleRun(
  pm: ProcessManager,
  name: BotName,
  scheduleId: string,
): Promise<ScheduleRunResult> {
  const result = await runtimeFetch(pm, name, `/api/schedules/${encodeURIComponent(scheduleId)}/run`, {
    method: "POST",
  });
  assertOk(result, "SCHEDULE_RUN_FAILED");
  return result.body as ScheduleRunResult;
}

/** Retrieve the run history for a schedule entry, optionally limited. */
export async function botScheduleHistory(
  pm: ProcessManager,
  name: BotName,
  scheduleId: string,
  limit?: number,
): Promise<ScheduleRunResult[]> {
  const query = limit !== undefined ? `?limit=${limit}` : "";
  const result = await runtimeFetch(pm, name, `/api/schedules/${encodeURIComponent(scheduleId)}/history${query}`);
  assertOk(result, "SCHEDULE_HISTORY_FAILED");
  return result.body as ScheduleRunResult[];
}
