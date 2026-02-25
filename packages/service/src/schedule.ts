import {
  type CasaName,
  type ScheduleEntry,
  type ScheduleRunResult,
  MechaError,
  parseInterval,
  InvalidIntervalError,
} from "@mecha/core";
import type { ProcessManager } from "@mecha/process";
import { runtimeFetch } from "./helpers.js";

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
  if (result.status >= 400) {
    const body = result.body as { error?: string };
    throw new MechaError(
      /* v8 ignore start -- fallback when error field missing */
      body?.error ?? `Schedule add failed: ${result.status}`,
      /* v8 ignore stop */
      { code: "SCHEDULE_ADD_FAILED", statusCode: result.status, exitCode: 1 },
    );
  }
}

export async function casaScheduleRemove(
  pm: ProcessManager,
  name: CasaName,
  scheduleId: string,
): Promise<void> {
  const result = await runtimeFetch(pm, name, `/api/schedules/${encodeURIComponent(scheduleId)}`, {
    method: "DELETE",
  });
  if (result.status >= 400) {
    const body = result.body as { error?: string };
    throw new MechaError(
      /* v8 ignore start -- fallback when error field missing */
      body?.error ?? `Schedule remove failed: ${result.status}`,
      /* v8 ignore stop */
      { code: "SCHEDULE_REMOVE_FAILED", statusCode: result.status, exitCode: 1 },
    );
  }
}

export async function casaScheduleList(
  pm: ProcessManager,
  name: CasaName,
): Promise<ScheduleEntry[]> {
  const result = await runtimeFetch(pm, name, "/api/schedules");
  /* v8 ignore start -- runtime list route does not produce errors */
  if (result.status >= 400) {
    const body = result.body as { error?: string };
    throw new MechaError(
      body?.error ?? `Schedule list failed: ${result.status}`,
      { code: "SCHEDULE_LIST_FAILED", statusCode: result.status, exitCode: 1 },
    );
  }
  /* v8 ignore stop */
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
  /* v8 ignore start -- runtime returns MechaError via route error handler */
  if (result.status >= 400) {
    const body = result.body as { error?: string };
    throw new MechaError(
      body?.error ?? `Schedule pause failed: ${result.status}`,
      { code: "SCHEDULE_PAUSE_FAILED", statusCode: result.status, exitCode: 1 },
    );
  }
  /* v8 ignore stop */
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
  /* v8 ignore start -- runtime returns MechaError via route error handler */
  if (result.status >= 400) {
    const body = result.body as { error?: string };
    throw new MechaError(
      body?.error ?? `Schedule resume failed: ${result.status}`,
      { code: "SCHEDULE_RESUME_FAILED", statusCode: result.status, exitCode: 1 },
    );
  }
  /* v8 ignore stop */
}

export async function casaScheduleRun(
  pm: ProcessManager,
  name: CasaName,
  scheduleId: string,
): Promise<ScheduleRunResult> {
  const result = await runtimeFetch(pm, name, `/api/schedules/${encodeURIComponent(scheduleId)}/run`, {
    method: "POST",
  });
  if (result.status >= 400) {
    const body = result.body as { error?: string };
    throw new MechaError(
      /* v8 ignore start -- fallback when error field missing */
      body?.error ?? `Schedule run failed: ${result.status}`,
      /* v8 ignore stop */
      { code: "SCHEDULE_RUN_FAILED", statusCode: result.status, exitCode: 1 },
    );
  }
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
  if (result.status >= 400) {
    const body = result.body as { error?: string };
    throw new MechaError(
      /* v8 ignore start -- fallback when error field missing */
      body?.error ?? `Schedule history failed: ${result.status}`,
      /* v8 ignore stop */
      { code: "SCHEDULE_HISTORY_FAILED", statusCode: result.status, exitCode: 1 },
    );
  }
  return result.body as ScheduleRunResult[];
}
