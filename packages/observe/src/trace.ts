import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { RunTrace, StepTrace } from "./types.js";

/** Validate a name used as a filesystem path segment. Rejects traversal attempts. */
function assertSafeName(name: string, label: string): void {
  if (!name || /[/\\]|^\.\.?$/.test(name) || name.includes("..")) {
    throw new Error(`Invalid ${label}: "${name}"`);
  }
}

/** File-backed store for workflow run traces. */
export interface TraceStore {
  /** Save a trace for a workflow run. */
  save(trace: RunTrace): void;

  /** Load a trace by run ID. Returns null if not found. */
  load(workflow: string, traceId: string): RunTrace | null;

  /** List traces for a workflow, most recent first. */
  list(workflow: string, limit?: number): RunTrace[];

  /** List all workflow names that have traces. */
  workflows(): string[];
}

/**
 * Create a file-backed trace store.
 * Traces are JSON files stored at: <tracesDir>/<workflow>/<traceId>.trace.json
 */
export function createTraceStore(tracesDir: string): TraceStore {
  mkdirSync(tracesDir, { recursive: true });

  return {
    save(trace) {
      assertSafeName(trace.workflow, "workflow");
      assertSafeName(trace.traceId, "traceId");
      const dir = join(tracesDir, trace.workflow);
      mkdirSync(dir, { recursive: true });
      const path = join(dir, `${trace.traceId}.trace.json`);
      writeFileSync(path, JSON.stringify(trace, null, 2) + "\n");
    },

    load(workflow, traceId) {
      assertSafeName(workflow, "workflow");
      assertSafeName(traceId, "traceId");
      const path = join(tracesDir, workflow, `${traceId}.trace.json`);
      if (!existsSync(path)) return null;
      return JSON.parse(readFileSync(path, "utf-8")) as RunTrace;
    },

    list(workflow, limit = 20) {
      const dir = join(tracesDir, workflow);
      if (!existsSync(dir)) return [];
      const files = readdirSync(dir)
        .filter((f) => f.endsWith(".trace.json"))
        .sort()
        .reverse()
        .slice(0, limit);
      return files.map((f) =>
        JSON.parse(readFileSync(join(dir, f), "utf-8")) as RunTrace,
      );
    },

    workflows() {
      if (!existsSync(tracesDir)) return [];
      return readdirSync(tracesDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    },
  };
}

/** Build a RunTrace from a workflow run state (adapter from workflow package types). */
export function buildTrace(opts: {
  runId: string;
  workflow: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  totalCostUsd: number;
  steps: Record<string, {
    status: string;
    startedAt?: string;
    completedAt?: string;
    costUsd?: number;
    error?: string;
  }>;
  stepBots: Record<string, string>;
}): RunTrace {
  const steps: StepTrace[] = [];
  for (const [id, step] of Object.entries(opts.steps)) {
    const durationMs = step.startedAt && step.completedAt
      ? new Date(step.completedAt).getTime() - new Date(step.startedAt).getTime()
      : undefined;

    steps.push({
      stepId: id,
      bot: opts.stepBots[id] ?? "unknown",
      status: step.status,
      startedAt: step.startedAt,
      completedAt: step.completedAt,
      duration: durationMs !== undefined ? `${(durationMs / 1000).toFixed(1)}s` : undefined,
      costUsd: step.costUsd ?? 0,
      error: step.error,
    });
  }

  return {
    traceId: opts.runId,
    workflow: opts.workflow,
    startedAt: opts.startedAt,
    completedAt: opts.completedAt,
    status: opts.status,
    totalCostUsd: opts.totalCostUsd,
    steps,
  };
}
