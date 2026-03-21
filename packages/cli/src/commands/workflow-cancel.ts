import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { withErrorHandler } from "../error-handler.js";
import { createEngine } from "@mecha/workflow";
import type { WorkflowDef } from "@mecha/workflow";

/** Register the 'workflow cancel' subcommand. */
export function registerWorkflowCancelCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("cancel")
    .description("Cancel an in-progress workflow run")
    .argument("<workflow>", "workflow name")
    .argument("<run-id>", "run ID")
    .action((workflow: string, runId: string) =>
      withErrorHandler(deps, async () => {
        const workflowsDir = join(deps.mechaDir, "workflows");
        const runsDir = join(workflowsDir, "runs", workflow);
        const statePath = join(runsDir, `${runId}.json`);

        if (!existsSync(statePath)) {
          deps.formatter.error(`Run "${runId}" not found for workflow "${workflow}"`);
          return;
        }

        // Load the definition snapshot
        const snapshotPath = join(runsDir, `${runId}.yaml`);
        /* v8 ignore start -- snapshot-missing branch requires corrupted workflow state */
        if (!existsSync(snapshotPath)) {
          deps.formatter.error(`Workflow snapshot not found for run "${runId}"`);
          return;
        }
        /* v8 ignore stop */

        const defRaw = readFileSync(snapshotPath, "utf-8");
        const definition = JSON.parse(defRaw) as WorkflowDef;

        const engine = createEngine({ workflowsDir, definition, runId });
        const state = engine.state();

        if (["done", "failed", "cancelled", "compensated"].includes(state.status)) {
          deps.formatter.warn(`Run "${runId}" is already ${state.status}`);
          return;
        }

        engine.cancel();
        deps.formatter.success(`Cancelled run "${runId}"`);
      }),
    );
}
