import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { withErrorHandler } from "../error-handler.js";
import { join } from "node:path";
import { createTraceStore, computeMetrics } from "@mecha/observe";

/** Register the 'meta report' subcommand. */
export function registerMetaReportCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("report")
    .description("Generate a summary report of company activity")
    .option("--days <days>", "Number of days to cover", "7")
    .action(async (opts: { days: string }) => withErrorHandler(deps, async () => {
      const tracesDir = join(deps.mechaDir, "observe", "traces");
      const store = createTraceStore(tracesDir);
      const workflows = store.workflows();

      if (workflows.length === 0) {
        deps.formatter.info("No workflow activity to report");
        return;
      }

      const days = parseInt(opts.days, 10) || 7;
      deps.formatter.info(`Company Report (last ${days} days)`);
      deps.formatter.info("─".repeat(40));

      let totalCost = 0;
      let totalRuns = 0;

      for (const wf of workflows) {
        const traces = store.list(wf, 100);
        const cutoff = new Date(Date.now() - days * 86400000).toISOString();
        const recent = traces.filter((t) => t.startedAt >= cutoff);
        /* v8 ignore start -- no recent traces in time window */
        if (recent.length === 0) continue;
        /* v8 ignore stop */

        const metrics = computeMetrics(recent, { by: "workflow", name: wf });
        /* v8 ignore start -- no matching metrics for workflow */
        if (!metrics) continue;
        /* v8 ignore stop */

        totalRuns += metrics.runCount;
        totalCost += metrics.avgCostUsd * metrics.runCount;

        deps.formatter.info(`\n${wf}:`);
        deps.formatter.info(`  Runs: ${metrics.runCount}  Success: ${(metrics.successRate * 100).toFixed(0)}%  Avg cost: $${metrics.avgCostUsd.toFixed(2)}`);
        if (metrics.avgQualityScore != null) {
          deps.formatter.info(`  Quality: ${metrics.avgQualityScore.toFixed(1)}/5`);
        }
      }

      deps.formatter.info(`\nTotal: ${totalRuns} runs, $${totalCost.toFixed(2)} spent`);
    }));
}
