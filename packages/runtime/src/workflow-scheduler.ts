import { readdirSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import YAML from "js-yaml";
import { parseScheduleExpression } from "@mecha/core";
import type { WorkflowDef } from "@mecha/workflow";

/** Structured logger callback for workflow scheduler events. */
export type WorkflowSchedulerLog = (
  level: "info" | "warn" | "error",
  msg: string,
  data?: Record<string, unknown>,
) => void;

/** Options for creating a workflow scheduler instance. */
export interface WorkflowSchedulerOpts {
  workflowsDir: string;  // Directory containing workflow YAML files
  stateDir: string;      // Directory for persisting scheduler state
  runWorkflow: (name: string) => Promise<void>;
  now?: () => number;
  log?: WorkflowSchedulerLog;
}

interface ScheduledWorkflow {
  name: string;
  schedule: string;
  timer?: ReturnType<typeof setTimeout>;
  lastRunAt?: string;
  consecutiveErrors: number;
  paused: boolean;
}

interface PersistedState {
  lastRunAt?: string;
  consecutiveErrors: number;
  paused: boolean;
}

const MAX_CONSECUTIVE_ERRORS = 5;

/* v8 ignore start -- default no-op logger */
const noopLog: WorkflowSchedulerLog = () => {};
/* v8 ignore stop */

/** Info about a scheduled workflow returned by list(). */
export interface WorkflowScheduleInfo {
  name: string;
  schedule: string;
  paused: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
}

/** Timer-based scheduler for trigger.schedule workflows. */
export interface WorkflowScheduler {
  start(): void;
  stop(): void;
  list(): WorkflowScheduleInfo[];
}

/** Scan workflow YAML files and schedule those with trigger.schedule. */
export function createWorkflowScheduler(opts: WorkflowSchedulerOpts): WorkflowScheduler {
  const { workflowsDir, stateDir, runWorkflow } = opts;
  const now = opts.now ?? Date.now;
  const log = opts.log ?? noopLog;
  const entries = new Map<string, ScheduledWorkflow>();
  let running = false;

  mkdirSync(stateDir, { recursive: true });

  function statePathFor(name: string): string {
    return join(stateDir, name, "state.json");
  }

  function loadState(name: string): PersistedState {
    const p = statePathFor(name);
    if (existsSync(p)) {
      try {
        return JSON.parse(readFileSync(p, "utf-8")) as PersistedState;
      /* v8 ignore start -- corrupt state fallback */
      } catch {
        return { consecutiveErrors: 0, paused: false };
      }
      /* v8 ignore stop */
    }
    return { consecutiveErrors: 0, paused: false };
  }

  function saveState(name: string, state: PersistedState): void {
    const dir = join(stateDir, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(statePathFor(name), JSON.stringify(state, null, 2) + "\n");
  }

  function clearTimer(entry: ScheduledWorkflow): void {
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = undefined;
    }
  }

  function armTimer(entry: ScheduledWorkflow): void {
    clearTimer(entry);
    if (entry.paused || !running) return;

    const parsed = parseScheduleExpression(entry.schedule);
    /* v8 ignore start -- validated at scan time */
    if (!parsed) return;
    /* v8 ignore stop */
    const delayMs = parsed.nextMs(new Date(now()));
    /* v8 ignore start -- no cron match within 48h */
    if (delayMs == null) return;
    /* v8 ignore stop */

    log("info", `Arming workflow timer for "${entry.name}"`, {
      nextRunAt: new Date(now() + delayMs).toISOString(), delayMs,
    });

    entry.timer = setTimeout(async () => {
      entry.timer = undefined;
      /* v8 ignore start -- race guard: stop() between arm and fire */
      if (!running) return;
      /* v8 ignore stop */

      log("info", `Executing scheduled workflow "${entry.name}"`);
      try {
        await runWorkflow(entry.name);
        entry.consecutiveErrors = 0;
      } catch (err) {
        entry.consecutiveErrors++;
        /* v8 ignore start -- non-Error throw fallback */
        const errorMsg = err instanceof Error ? err.message : String(err);
        /* v8 ignore stop */
        log("error", `Workflow "${entry.name}" failed`, {
          error: errorMsg, consecutiveErrors: entry.consecutiveErrors,
        });
      }
      entry.lastRunAt = new Date(now()).toISOString();

      // Auto-pause after too many consecutive errors
      if (entry.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        entry.paused = true;
        log("warn", `Workflow "${entry.name}" auto-paused after ${entry.consecutiveErrors} consecutive errors`);
      }

      saveState(entry.name, {
        lastRunAt: entry.lastRunAt,
        consecutiveErrors: entry.consecutiveErrors,
        paused: entry.paused,
      });

      // Re-arm for next execution (chained setTimeout)
      if (running && !entry.paused) armTimer(entry);
    }, delayMs);
  }

  function scanWorkflows(): void {
    if (!existsSync(workflowsDir)) return;
    const files = readdirSync(workflowsDir).filter(
      (f) => f.endsWith(".yaml") || f.endsWith(".yml"),
    );
    for (const file of files) {
      try {
        const content = readFileSync(join(workflowsDir, file), "utf-8");
        const def = YAML.load(content) as WorkflowDef;
        if (!def?.name || !def?.trigger?.schedule) continue;
        const schedule = def.trigger.schedule;
        const parsed = parseScheduleExpression(schedule);
        if (!parsed) {
          log("warn", `Invalid schedule expression in ${file}: "${schedule}"`);
          continue;
        }
        const persisted = loadState(def.name);
        entries.set(def.name, {
          name: def.name,
          schedule,
          consecutiveErrors: persisted.consecutiveErrors,
          paused: persisted.paused,
          lastRunAt: persisted.lastRunAt,
        });
      /* v8 ignore start -- corrupt YAML fallback */
      } catch (err) {
        log("error", `Failed to parse workflow file ${file}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      /* v8 ignore stop */
    }
  }

  return {
    start() {
      running = true;
      scanWorkflows();
      log("info", `Workflow scheduler started: ${entries.size} scheduled workflow(s)`);
      for (const entry of entries.values()) {
        if (!entry.paused) armTimer(entry);
      }
    },

    stop() {
      running = false;
      log("info", "Workflow scheduler stopped");
      for (const entry of entries.values()) {
        clearTimer(entry);
      }
    },

    list(): WorkflowScheduleInfo[] {
      const result: WorkflowScheduleInfo[] = [];
      for (const entry of entries.values()) {
        let nextRunAt: string | undefined;
        if (!entry.paused) {
          const parsed = parseScheduleExpression(entry.schedule);
          const ms = parsed?.nextMs(new Date(now()));
          if (ms != null) nextRunAt = new Date(now() + ms).toISOString();
        }
        result.push({
          name: entry.name,
          schedule: entry.schedule,
          paused: entry.paused,
          lastRunAt: entry.lastRunAt,
          nextRunAt,
        });
      }
      return result;
    },
  };
}
