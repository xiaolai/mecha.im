import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { join } from "node:path";
import { createAlertEngine } from "@mecha/observe";
import { withErrorHandler } from "../error-handler.js";

/** Register the 'alert add' subcommand. */
export function registerAlertAddCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("add")
    .description("Add an alert rule")
    .argument("<id>", "unique rule ID")
    .requiredOption("--metric <m>", "metric name to monitor")
    .requiredOption("--threshold <n>", "threshold value")
    .requiredOption("--comparison <op>", "comparison operator (gt|lt|gte|lte)")
    .requiredOption("--message <msg>", "alert message")
    .action(
      (
        id: string,
        opts: { metric: string; threshold: string; comparison: string; message: string },
      ) =>
        withErrorHandler(deps, async () => {
          const validComparisons = ["gt", "lt", "gte", "lte"];
          if (!validComparisons.includes(opts.comparison)) {
            deps.formatter.error(
              `Invalid comparison "${opts.comparison}". Must be one of: ${validComparisons.join(", ")}`,
            );
            process.exitCode = 1;
            return;
          }

          const threshold = parseFloat(opts.threshold);
          if (isNaN(threshold)) {
            deps.formatter.error("Threshold must be a number");
            process.exitCode = 1;
            return;
          }

          const engine = createAlertEngine(join(deps.mechaDir, "observe", "alerts"));
          engine.addRule({
            id,
            metric: opts.metric,
            threshold,
            comparison: opts.comparison as "gt" | "lt" | "gte" | "lte",
            message: opts.message,
          });

          deps.formatter.success(`Alert rule "${id}" added`);
        }),
    );
}
