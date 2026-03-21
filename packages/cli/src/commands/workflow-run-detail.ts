import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { withErrorHandler } from "../error-handler.js";
import type { RunState } from "@mecha/workflow";

/** Find the run state file by run ID across all workflow run dirs. */
function findRunFile(workflowsDir: string, runId: string): string | undefined {
  const runsRoot = join(workflowsDir, "runs");
  /* v8 ignore start -- requires workflow run files on disk */
  if (!existsSync(runsRoot)) return undefined;
  /* v8 ignore stop */

  for (const wfName of readdirSync(runsRoot)) {
    const candidate = join(runsRoot, wfName, `${runId}.json`);
    if (existsSync(candidate)) return candidate;
  }
  /* v8 ignore start -- no matching run file found */
  return undefined;
  /* v8 ignore stop */
}

/** Register the 'workflow run-detail' subcommand. */
export function registerWorkflowRunDetailCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("run-detail")
    .description("Show detailed status for a workflow run")
    .argument("<run-id>", "run ID")
    .action((runId: string) =>
      withErrorHandler(deps, async () => {
        const workflowsDir = join(deps.mechaDir, "workflows");
        const filePath = findRunFile(workflowsDir, runId);

        if (!filePath) {
          deps.formatter.error(`Run "${runId}" not found`);
          return;
        }

        const raw = readFileSync(filePath, "utf-8");
        const run = JSON.parse(raw) as RunState;

        if (deps.formatter.isJson) {
          deps.formatter.json(run);
          return;
        }

        deps.formatter.info(`Run: ${run.runId}`);
        deps.formatter.info(`Workflow: ${run.workflow}`);
        deps.formatter.info(`Status: ${run.status}`);
        deps.formatter.info(`Started: ${run.startedAt}`);
        if (run.completedAt) deps.formatter.info(`Completed: ${run.completedAt}`);
        deps.formatter.info(`Total cost: $${run.totalCostUsd.toFixed(4)}`);

        deps.formatter.info("\nSteps:");
        deps.formatter.table(
          ["Step", "Status", "Cost", "Duration", "Error"],
          Object.entries(run.steps).map(([name, step]) => {
            const duration =
              step.startedAt && step.completedAt
                ? `${(new Date(step.completedAt).getTime() - new Date(step.startedAt).getTime())}ms`
                : "-";
            return [
              name,
              step.status,
              step.costUsd !== undefined ? `$${step.costUsd.toFixed(4)}` : "-",
              duration,
              step.error ?? "-",
            ];
          }),
        );
      }),
    );
}
