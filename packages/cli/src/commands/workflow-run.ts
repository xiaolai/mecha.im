import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import YAML from "js-yaml";
import { withErrorHandler } from "../error-handler.js";
import { createEngine, createDryRunExecutor } from "@mecha/workflow";
import type { WorkflowDef, StepExecutor } from "@mecha/workflow";
import { assertSafeName, botName, parseInterval } from "@mecha/core";
import { botChat } from "@mecha/service";
import { createTraceStore, buildTrace } from "@mecha/observe";

/** Validate parsed YAML is a valid WorkflowDef. Returns error message or null. */
function validateWorkflowShape(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== "object") return "must be a YAML object";
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.name !== "string" || !obj.name) return `"name" must be a non-empty string`;
  if (!obj.steps || typeof obj.steps !== "object" || Array.isArray(obj.steps)) return `"steps" must be a map`;
  const steps = obj.steps as Record<string, unknown>;
  if (Object.keys(steps).length === 0) return `"steps" must have at least one step`;
  for (const [stepName, stepVal] of Object.entries(steps)) {
    if (!stepVal || typeof stepVal !== "object") return `step "${stepName}" must be an object`;
    const step = stepVal as Record<string, unknown>;
    if (typeof step.bot !== "string" || !step.bot) return `step "${stepName}" is missing required "bot" field`;
    if (typeof step.prompt !== "string" || !step.prompt) return `step "${stepName}" is missing required "prompt" field`;
  }
  return null;
}

/** Parse repeatable --input key=value flags into a Record. */
function parseInputs(pairs: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    /* v8 ignore start -- CLI input validation */
    if (eq === -1) throw new Error(`Invalid input format: "${pair}" (expected key=value)`);
    /* v8 ignore stop */
    result[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return result;
}

/** Register the 'workflow run' subcommand. */
export function registerWorkflowRunCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("run")
    .description("Start a new workflow run")
    .argument("<name>", "workflow name")
    .option("--input <key=value...>", "Input values (repeatable)", (v: string, prev: string[]) => {
      prev.push(v);
      return prev;
    }, [] as string[])
    .option("--dry-run", "Execute with mock bot responses (no real API calls)")
    .action((name: string, opts: { input: string[]; dryRun?: boolean }) =>
      withErrorHandler(deps, async () => {
        // Prevent path traversal — name must be a safe filesystem segment
        assertSafeName(name, "workflow");

        const workflowsDir = join(deps.mechaDir, "workflows");
        let filePath = join(workflowsDir, `${name}.yaml`);
        if (!existsSync(filePath)) {
          filePath = join(workflowsDir, `${name}.yml`);
        }

        if (!existsSync(filePath)) {
          deps.formatter.error(`Workflow "${name}" not found (checked .yaml and .yml)`);
          return;
        }

        const raw = readFileSync(filePath, "utf-8");
        const parsed = YAML.load(raw);
        const validationError = validateWorkflowShape(parsed);
        if (validationError) {
          deps.formatter.error(`Invalid workflow "${name}": ${validationError}`);
          return;
        }
        const definition = parsed as WorkflowDef;
        const inputs = parseInputs(opts.input);

        const engine = createEngine({ workflowsDir, definition });
        const runId = engine.startRun(inputs);

        const prefix = opts.dryRun ? "[DRY RUN] " : "";
        deps.formatter.info(`${prefix}Started run: ${runId}`);

        const executor: StepExecutor = opts.dryRun
          ? createDryRunExecutor()
          : async ({ bot, prompt, timeout }) => {
              const validated = botName(bot);
              // Default to 10 minutes (aligned with runtime CHAT_TIMEOUT_MS) when step has no timeout
              const timeoutMs = (timeout ? parseInterval(timeout) : undefined) ?? 10 * 60 * 1000;
              const signal = AbortSignal.timeout(timeoutMs);
              const result = await botChat(deps.processManager, validated, {
                message: prompt,
                // Do not pass stepRunId as sessionId — it's not a valid UUID.
                // Each workflow step starts a fresh SDK session.
              }, signal);
              return { output: result.response, costUsd: result.costUsd };
            };

        // Execute until terminal or waiting for a gate
        while (!engine.isTerminal()) {
          const executed = await engine.executeReady(executor);
          /* v8 ignore start -- gate-waiting branch requires workflow with human gates */
          if (executed.length === 0) break; // waiting for gate or no more steps
          /* v8 ignore stop */
          for (const step of executed) {
            const stepState = engine.state().steps[step]!;
            deps.formatter.info(`${prefix}  Step "${step}": ${stepState.status}`);
          }
        }

        const finalState = engine.state();
        deps.formatter.info(`\n${prefix}Run ${runId}: ${finalState.status}`);

        if (finalState.totalCostUsd > 0) {
          deps.formatter.info(`Total cost: $${finalState.totalCostUsd.toFixed(4)}`);
        }

        /* v8 ignore start -- waiting status requires human gate workflow */
        if (finalState.status === "waiting") {
          deps.formatter.warn("Run is waiting for human gate approval");
        }
        /* v8 ignore stop */

        // Auto-generate observe trace for completed/failed runs
        if (!opts.dryRun && (finalState.status === "done" || finalState.status === "failed")) {
          const tracesDir = join(deps.mechaDir, "observe", "traces");
          const traceStore = createTraceStore(tracesDir);
          const stepBots: Record<string, string> = {};
          for (const [sn, sd] of Object.entries(definition.steps)) stepBots[sn] = sd.bot;
          traceStore.save(buildTrace({
            runId,
            workflow: definition.name,
            status: finalState.status,
            startedAt: finalState.startedAt,
            completedAt: finalState.completedAt,
            totalCostUsd: finalState.totalCostUsd,
            steps: finalState.steps,
            stepBots,
          }));
        }

        /* v8 ignore start -- JSON output path */
        if (deps.formatter.isJson) {
          deps.formatter.json(finalState);
        }
        /* v8 ignore stop */
      }),
    );
}
