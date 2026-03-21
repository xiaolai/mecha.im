import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { join } from "node:path";
import { createTraceStore, computeMetrics } from "@mecha/observe";
import { withErrorHandler } from "../error-handler.js";

/** Register the 'metrics bot' subcommand. */
export function registerMetricsBotCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("bot")
    .description("Show per-bot performance metrics")
    .argument("<name>", "bot name")
    .option("--days <n>", "number of days to include", "7")
    .action((name: string, opts: { days: string }) =>
      withErrorHandler(deps, async () => {
        const store = createTraceStore(join(deps.mechaDir, "observe", "traces"));
        const days = parseInt(opts.days, 10);
        const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();

        // Collect all traces across workflows, filtered by date
        const workflows = store.workflows();
        const allTraces = workflows
          .flatMap((wf) => store.list(wf))
          .filter((t) => t.startedAt >= cutoff);

        const summary = computeMetrics(allTraces, { by: "bot", name });

        if (!summary) {
          deps.formatter.info(`No metrics found for bot "${name}" in the last ${days} days`);
          return;
        }

        if (deps.formatter.isJson) {
          deps.formatter.json(summary);
          return;
        }

        deps.formatter.info(`Bot: ${summary.name}`);
        deps.formatter.info(`Period: ${summary.period.from} to ${summary.period.to}`);
        deps.formatter.info(`Steps: ${summary.runCount}`);
        deps.formatter.info(`Success rate: ${(summary.successRate * 100).toFixed(1)}%`);
        deps.formatter.info(`Avg cost: $${summary.avgCostUsd.toFixed(4)}`);
        deps.formatter.info(`Avg duration: ${(summary.avgDurationMs / 1000).toFixed(1)}s`);
        /* v8 ignore start -- optional quality/revision fields */
        if (summary.avgQualityScore != null) {
          deps.formatter.info(`Avg quality: ${summary.avgQualityScore.toFixed(1)}/5`);
        }
        /* v8 ignore stop */
        if (summary.revisionRate != null) {
          deps.formatter.info(`Revision rate: ${(summary.revisionRate * 100).toFixed(1)}%`);
        }
      }),
    );
}
