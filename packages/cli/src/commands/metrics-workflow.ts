import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { join } from "node:path";
import { createTraceStore, computeMetrics } from "@mecha/observe";
import { withErrorHandler } from "../error-handler.js";

/** Register the 'metrics workflow' subcommand. */
export function registerMetricsWorkflowCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("workflow")
    .description("Show per-workflow metrics")
    .argument("<name>", "workflow name")
    .action((name: string) =>
      withErrorHandler(deps, async () => {
        const store = createTraceStore(join(deps.mechaDir, "observe", "traces"));

        // Collect all traces across workflows
        const workflows = store.workflows();
        const allTraces = workflows.flatMap((wf) => store.list(wf));

        const summary = computeMetrics(allTraces, { by: "workflow", name });

        if (!summary) {
          deps.formatter.info(`No metrics found for workflow "${name}"`);
          return;
        }

        if (deps.formatter.isJson) {
          deps.formatter.json(summary);
          return;
        }

        deps.formatter.info(`Workflow: ${summary.name}`);
        deps.formatter.info(`Period: ${summary.period.from} to ${summary.period.to}`);
        deps.formatter.info(`Runs: ${summary.runCount}`);
        deps.formatter.info(`Success rate: ${(summary.successRate * 100).toFixed(1)}%`);
        deps.formatter.info(`Avg cost: $${summary.avgCostUsd.toFixed(4)}`);
        deps.formatter.info(`Avg duration: ${(summary.avgDurationMs / 1000).toFixed(1)}s`);
        /* v8 ignore start -- optional quality score field */
        if (summary.avgQualityScore != null) {
          deps.formatter.info(`Avg quality: ${summary.avgQualityScore.toFixed(1)}/5`);
        }
        /* v8 ignore stop */
      }),
    );
}
