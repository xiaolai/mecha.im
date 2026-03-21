import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { join } from "node:path";
import { createTraceStore } from "@mecha/observe";
import { withErrorHandler } from "../error-handler.js";

/** Register the 'trace show' subcommand. */
export function registerTraceShowCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("show")
    .description("Display structured trace for a workflow run")
    .argument("<workflow>", "workflow name")
    .argument("<run-id>", "run ID")
    .action((workflow: string, runId: string) =>
      withErrorHandler(deps, async () => {
        const store = createTraceStore(join(deps.mechaDir, "observe", "traces"));
        const trace = store.load(workflow, runId);

        if (!trace) {
          deps.formatter.info(`No trace found for ${workflow}/${runId}`);
          return;
        }

        if (deps.formatter.isJson) {
          deps.formatter.json(trace);
          return;
        }

        deps.formatter.info(`Trace: ${trace.traceId}`);
        deps.formatter.info(`Workflow: ${trace.workflow}`);
        deps.formatter.info(`Status: ${trace.status}`);
        deps.formatter.info(`Started: ${trace.startedAt}`);
        if (trace.completedAt) deps.formatter.info(`Completed: ${trace.completedAt}`);
        deps.formatter.info(`Cost: $${trace.totalCostUsd.toFixed(4)}`);
        /* v8 ignore start -- optional quality score field */
        if (trace.qualityScore != null) deps.formatter.info(`Quality: ${trace.qualityScore}/5`);
        /* v8 ignore stop */

        if (trace.steps.length > 0) {
          deps.formatter.table(
            ["Step", "Bot", "Status", "Duration", "Cost"],
            trace.steps.map((s) => [
              s.stepId,
              s.bot,
              s.status,
              s.duration ?? "-",
              `$${s.costUsd.toFixed(4)}`,
            ]),
          );
        }
      }),
    );
}
