import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { registerMetricsBotCommand } from "./metrics-bot.js";
import { registerMetricsWorkflowCommand } from "./metrics-workflow.js";

/** Register the 'metrics' command group. */
export function registerMetricsCommand(program: Command, deps: CommandDeps): void {
  const metrics = program
    .command("metrics")
    .description("View performance metrics");

  registerMetricsBotCommand(metrics, deps);
  registerMetricsWorkflowCommand(metrics, deps);
}
