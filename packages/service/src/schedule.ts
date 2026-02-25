import {
  type CasaName,
  type ScheduleEntry,
  type ScheduleRunResult,
  parseInterval,
  InvalidIntervalError,
} from "@mecha/core";
import type { ProcessManager } from "@mecha/process";
import { runtimeFetch, assertOk } from "./helpers.js";

export async function casaScheduleAdd(
  pm: ProcessManager,
  name: CasaName,
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

export async function casaScheduleRemove(
  pm: ProcessManager,
  name: CasaName,
  scheduleId: string,
): Promise<void> {
  const result = await runtimeFetch(pm, name, `/api/schedules/${encodeURIComponent(scheduleId)}`, {
    method: "DELETE",
  });
  assertOk(result, "SCHEDULE_REMOVE_FAILED");
}

export async function casaScheduleList(
  pm: ProcessManager,
  name: CasaName,
): Promise<ScheduleEntry[]> {
  const result = await runtimeFetch(pm, name, "/api/schedules");
  assertOk(result, "SCHEDULE_LIST_FAILED");
  return result.body as ScheduleEntry[];
}

export async function casaSchedulePause(
  pm: ProcessManager,
  name: CasaName,
  scheduleId?: string,
): Promise<void> {
  const path = scheduleId
    ? `/api/schedules/${encodeURIComponent(scheduleId)}/pause`
    : "/api/schedules/pause-all";
  const result = await runtimeFetch(pm, name, path, { method: "POST" });
  assertOk(result, "SCHEDULE_PAUSE_FAILED");
}

export async function casaScheduleResume(
  pm: ProcessManager,
  name: CasaName,
  scheduleId?: string,
): Promise<void> {
  const path = scheduleId
    ? `/api/schedules/${encodeURIComponent(scheduleId)}/resume`
    : "/api/schedules/resume-all";
  const result = await runtimeFetch(pm, name, path, { method: "POST" });
  assertOk(result, "SCHEDULE_RESUME_FAILED");
}

export async function casaScheduleRun(
  pm: ProcessManager,
  name: CasaName,
  scheduleId: string,
): Promise<ScheduleRunResult> {
  const result = await runtimeFetch(pm, name, `/api/schedules/${encodeURIComponent(scheduleId)}/run`, {
    method: "POST",
  });
  assertOk(result, "SCHEDULE_RUN_FAILED");
  return result.body as ScheduleRunResult;
}

export async function casaScheduleHistory(
  pm: ProcessManager,
  name: CasaName,
  scheduleId: string,
  limit?: number,
): Promise<ScheduleRunResult[]> {
  const query = limit ? `?limit=${limit}` : "";
  const result = await runtimeFetch(pm, name, `/api/schedules/${encodeURIComponent(scheduleId)}/history${query}`);
  assertOk(result, "SCHEDULE_HISTORY_FAILED");
  return result.body as ScheduleRunResult[];
}
