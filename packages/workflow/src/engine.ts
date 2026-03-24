import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  RunState,
  StepState,
  WorkflowEngine,
  CreateEngineOpts,
} from "./types.js";
import { renderTemplate, evaluateCondition } from "./template.js";
import { parseInterval, atomicWriteSync, assertSafeName } from "@mecha/core";

const DEFAULT_STEP_TIMEOUT_MS = 600_000; // 10 minutes

function parseTimeout(timeout?: string): number {
  if (!timeout) return DEFAULT_STEP_TIMEOUT_MS;
  return parseInterval(timeout) ?? DEFAULT_STEP_TIMEOUT_MS;
}

/** Detect cycles in the step dependency graph. Throws if a cycle is found. */
function assertNoCycles(steps: Record<string, { depends?: string[] }>): void {
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(name: string): void {
    if (visited.has(name)) return;
    if (visiting.has(name)) throw new Error(`Cycle detected in workflow dependencies involving "${name}"`);
    visiting.add(name);
    const deps = steps[name]?.depends ?? [];
    for (const dep of deps) {
      const depName = dep.endsWith("?") ? dep.slice(0, -1) : dep;
      if (!steps[depName]) throw new Error(`Step "${name}" depends on unknown step "${depName}"`);
      visit(depName);
    }
    visiting.delete(name);
    visited.add(name);
  }

  for (const name of Object.keys(steps)) visit(name);
}

/** Validate step output against a simple schema. Returns array of error strings. */
function validateOutput(output: unknown, schema: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const schemaType = schema.type as string | undefined;

  if (schemaType === "object") {
    if (typeof output !== "object" || output === null) {
      errors.push(`Expected object, got ${typeof output}`);
      return errors;
    }
    const obj = output as Record<string, unknown>;
    const required = (schema.required as string[]) ?? [];
    for (const key of required) {
      if (!(key in obj)) {
        errors.push(`Missing required field: ${key}`);
      }
    }
    const properties = (schema.properties as Record<string, { type?: string }>) ?? {};
    for (const [key, propSchema] of Object.entries(properties)) {
      if (key in obj && propSchema.type) {
        const actual = typeof obj[key];
        if (actual !== propSchema.type) {
          errors.push(`Field "${key}": expected ${propSchema.type}, got ${actual}`);
        }
      }
    }
  }

  return errors;
}

/**
 * Create a workflow engine for a specific workflow definition.
 * State is persisted to JSON files in the runs directory.
 */
export function createEngine(opts: CreateEngineOpts): WorkflowEngine {
  const { workflowsDir, definition } = opts;
  assertSafeName(definition.name, "workflow");
  if (opts.runId) assertSafeName(opts.runId, "runId");
  assertNoCycles(definition.steps);
  const runsDir = join(workflowsDir, "runs", definition.name);
  mkdirSync(runsDir, { recursive: true });

  let runState: RunState | null = null;

  if (opts.runId) {
    const statePath = join(runsDir, `${opts.runId}.json`);
    if (existsSync(statePath)) {
      try {
        runState = JSON.parse(readFileSync(statePath, "utf-8")) as RunState;
      } catch {
        // Corrupt state file — treat as no prior state
        runState = null;
      }
    }
  }

  function saveState(): void {
    /* v8 ignore start -- defensive: saveState only called after startRun */
    if (!runState) return;
    /* v8 ignore stop */
    const statePath = join(runsDir, `${runState.runId}.json`);
    atomicWriteSync(statePath, JSON.stringify(runState, null, 2) + "\n");
  }

  /** Build template context from completed step outputs + inputs. */
  function buildContext(): Record<string, unknown> {
    /* v8 ignore start -- defensive: buildContext only called during execution */
    if (!runState) return {};
    /* v8 ignore stop */
    const ctx: Record<string, unknown> = { ...runState.inputs };
    for (const [name, step] of Object.entries(runState.steps)) {
      if ((step.status === "completed" || step.status === "compensating" || step.status === "compensated") && step.output !== undefined) {
        const outputKey = definition.steps[name]?.output ?? name;
        ctx[name] = { [outputKey]: step.output };
      }
    }
    return ctx;
  }

  /** Check if all dependencies of a step are satisfied. */
  function depsReady(stepName: string): boolean {
    /* v8 ignore start -- defensive: depsReady only called during execution */
    if (!runState) return false;
    /* v8 ignore stop */
    const stepDef = definition.steps[stepName];
    if (!stepDef?.depends) return true;

    for (const dep of stepDef.depends) {
      // Optional deps end with "?"
      const isOptional = dep.endsWith("?");
      const depName = isOptional ? dep.slice(0, -1) : dep;
      const depState = runState.steps[depName];
      /* v8 ignore start -- defensive: assertNoCycles validates all deps exist */
      if (!depState) return false;
      /* v8 ignore stop */
      if (depState.status === "completed") continue;
      if (depState.status === "skipped" && isOptional) continue;
      return false;
    }
    return true;
  }

  /** Get step names that are ready to execute. */
  function readySteps(): string[] {
    /* v8 ignore start -- defensive: readySteps only called during execution */
    if (!runState) return [];
    /* v8 ignore stop */
    const ready: string[] = [];
    for (const [name, step] of Object.entries(runState.steps)) {
      if (step.status !== "pending") continue;
      if (!depsReady(name)) continue;

      const stepDef = definition.steps[name]!;

      // Safety guard: prevent execution if maxRetries exhausted
      // maxRetries must be > 0 to take effect; 0 or negative values are ignored
      if (stepDef.maxRetries != null && stepDef.maxRetries > 0 && step.attempts >= stepDef.maxRetries) {
        step.status = "failed";
        step.error = `Max retries exceeded (${stepDef.maxRetries})`;
        step.completedAt = new Date().toISOString();
        saveState();
        continue;
      }
      if (stepDef.condition) {
        const ctx = buildContext();
        if (!evaluateCondition(stepDef.condition, ctx)) {
          step.status = "skipped";
          saveState();
          continue;
        }
      }

      // Check gate (skip if already approved)
      if (stepDef.gate === "human" && !step.gateApproved) {
        step.status = "waiting";
        saveState();
        continue;
      }

      ready.push(name);
    }
    return ready;
  }

  /** Update overall run status based on step states. */
  function updateRunStatus(): void {
    /* v8 ignore start -- defensive: updateRunStatus only called after startRun */
    if (!runState) return;
    /* v8 ignore stop */
    const steps = Object.values(runState.steps);
    const hasFailed = steps.some((s) => s.status === "failed");
    const hasWaiting = steps.some((s) => s.status === "waiting");
    const allDone = steps.every((s) => s.status === "completed" || s.status === "skipped");
    if (hasFailed) {
      runState.status = "failed";
    } else if (hasWaiting) {
      runState.status = "waiting";
    } else if (allDone) {
      runState.status = "done";
      runState.completedAt = new Date().toISOString();

      // Compute workflow outputs
      if (definition.outputs) {
        const ctx = buildContext();
        runState.outputs = {};
        for (const [key, tmpl] of Object.entries(definition.outputs)) {
          runState.outputs[key] = renderTemplate(tmpl, ctx);
        }
      }
    }
    saveState();
  }

  const engine: WorkflowEngine = {
    startRun(inputs = {}) {
      const runId = opts.runId ?? `run-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;

      // Merge defaults from workflow inputs
      const mergedInputs: Record<string, unknown> = {};
      if (definition.inputs) {
        for (const [key, def] of Object.entries(definition.inputs)) {
          mergedInputs[key] = inputs[key] ?? def.default;
        }
      }
      Object.assign(mergedInputs, inputs);

      // Initialize step states
      const steps: Record<string, StepState> = {};
      for (const name of Object.keys(definition.steps)) {
        steps[name] = {
          status: "pending",
          stepRunId: `${runId}:${name}:${randomUUID().slice(0, 8)}`,
          attempts: 0,
        };
      }

      runState = {
        runId,
        workflow: definition.name,
        status: "pending",
        inputs: mergedInputs,
        steps,
        startedAt: new Date().toISOString(),
        totalCostUsd: 0,
      };

      // Snapshot definition
      const snapshotPath = join(runsDir, `${runId}.yaml`);
      const defJson = JSON.stringify(definition, null, 2);
      writeFileSync(snapshotPath, defJson + "\n");

      saveState();
      return runId;
    },

    async executeReady(executor) {
      if (!runState) throw new Error("No active run. Call startRun() first.");
      if (engine.isTerminal()) return [];

      runState.status = "running";
      saveState();

      const ready = readySteps();
      const executed: string[] = [];

      // Execute ready steps in parallel (they are independent — no mutual dependencies)
      await Promise.all(ready.map(async (stepName) => {
        const stepDef = definition.steps[stepName]!;
        const step = runState!.steps[stepName]!;

        // Idempotency: skip if already has a result
        if (step.output !== undefined) {
          step.status = "completed";
          saveState();
          executed.push(stepName);
          return;
        }

        step.status = "running";
        step.startedAt = new Date().toISOString();
        step.attempts++;
        saveState();

        try {
          const ctx = buildContext();
          const renderedPrompt = renderTemplate(stepDef.prompt, ctx);
          const timeoutMs = parseTimeout(stepDef.timeout);
          let timer: ReturnType<typeof setTimeout>;

          const result = await Promise.race([
            executor({
              bot: stepDef.bot,
              prompt: renderedPrompt,
              stepRunId: step.stepRunId,
              timeout: stepDef.timeout,
              budgetUsd: stepDef.budgetUsd,
            }),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error(`Step timed out after ${stepDef.timeout ?? "10m"}`)),
                timeoutMs,
              );
            }),
          ]).finally(() => clearTimeout(timer));

          step.output = result.output;
          step.costUsd = result.costUsd ?? 0;

          // Output schema validation
          if (stepDef.outputSchema) {
            let parsed = step.output;
            if (typeof parsed === "string") {
              try { parsed = JSON.parse(parsed); } catch { /* use as-is */ }
            }
            const errors = validateOutput(parsed, stepDef.outputSchema);
            if (errors.length > 0) {
              step.status = "failed";
              step.error = `Output schema validation failed: ${errors.join("; ")}`;
              step.completedAt = new Date().toISOString();
              runState!.totalCostUsd += step.costUsd;
              saveState();
              executed.push(stepName);
              return;
            }
          }

          step.status = "completed";
          step.completedAt = new Date().toISOString();
          runState!.totalCostUsd += step.costUsd;
        } catch (err) {
          /* v8 ignore start -- non-Error throw fallback */
          const errorMsg = err instanceof Error ? err.message : String(err);
          /* v8 ignore stop */

          // If maxRetries is set (and > 0) and we haven't exhausted attempts, retry
          if (stepDef.maxRetries != null && stepDef.maxRetries > 0 && step.attempts < stepDef.maxRetries) {
            step.status = "pending";  // back to pending for re-execution
            step.error = errorMsg;    // preserve last error for debugging
          } else {
            step.status = "failed";
            step.error = stepDef.maxRetries != null && stepDef.maxRetries > 0
              ? `Max retries exceeded (${stepDef.maxRetries}): ${errorMsg}`
              : errorMsg;
            step.completedAt = new Date().toISOString();
          }
        }

        saveState();
        executed.push(stepName);
      }));

      // Budget enforcement — checked after all parallel steps complete
      if (definition.budgetUsd != null && runState.totalCostUsd >= definition.budgetUsd) {
        for (const [, sState] of Object.entries(runState.steps)) {
          if (sState.status === "pending") {
            sState.status = "failed";
            sState.error = "Budget exceeded";
            sState.completedAt = new Date().toISOString();
          }
        }
        runState.status = "failed";
        runState.completedAt = new Date().toISOString();
        saveState();
      }

      updateRunStatus();
      return executed;
    },

    approveGate(stepName) {
      if (!runState) return false;
      const step = runState.steps[stepName];
      if (!step || step.status !== "waiting") return false;
      step.status = "pending"; // back to pending so executeReady picks it up
      step.gateApproved = true;
      runState.status = "running";
      saveState();
      return true;
    },

    cancel() {
      if (!runState || engine.isTerminal()) return;
      runState.status = "cancelled";
      runState.completedAt = new Date().toISOString();
      saveState();
    },

    state() {
      if (!runState) throw new Error("No active run");
      return { ...runState };
    },

    isTerminal() {
      if (!runState) return false;
      return ["done", "failed", "cancelled", "compensated"].includes(runState.status);
    },

    async compensate(executor) {
      if (!runState) throw new Error("No active run");
      if (runState.status !== "failed") return [];

      runState.status = "compensating";
      saveState();

      // Walk completed steps in reverse order
      const stepNames = Object.keys(definition.steps);
      const completedInOrder = stepNames.filter(
        (name) => runState!.steps[name]?.status === "completed",
      );
      completedInOrder.reverse();

      const compensated: string[] = [];
      let compensationFailed = false;
      for (const name of completedInOrder) {
        const stepDef = definition.steps[name]!;
        if (!stepDef.compensate) continue;

        const step = runState.steps[name]!;
        step.status = "compensating";
        saveState();

        try {
          await executor({
            bot: stepDef.bot,
            prompt: renderTemplate(stepDef.compensate, buildContext()),
            stepRunId: `${step.stepRunId}:compensate`,
          });
          step.status = "compensated";
        } catch (err) {
          step.status = "failed"; // compensation itself failed
          /* v8 ignore start -- non-Error throw fallback */
          step.error = `Compensation failed: ${err instanceof Error ? err.message : String(err)}`;
          /* v8 ignore stop */
          compensationFailed = true;
        }
        saveState();
        compensated.push(name);
      }

      runState.status = compensationFailed ? "failed" : "compensated";
      runState.completedAt = new Date().toISOString();
      saveState();
      return compensated;
    },
  };

  return engine;
}
