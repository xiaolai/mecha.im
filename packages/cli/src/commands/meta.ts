import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { registerMetaGoalCommand } from "./meta-goal.js";
import { registerMetaStatusCommand } from "./meta-status.js";
import { registerMetaReportCommand } from "./meta-report.js";
import { registerMetaTuneCommand } from "./meta-tune.js";
import { registerMetaExperimentCommand } from "./meta-experiment.js";

/** Register the 'meta' command group. */
export function registerMetaCommand(program: Command, deps: CommandDeps): void {
  const meta = program
    .command("meta")
    .description("Meta-agent (CEO bot) commands");

  registerMetaGoalCommand(meta, deps);
  registerMetaStatusCommand(meta, deps);
  registerMetaReportCommand(meta, deps);
  registerMetaTuneCommand(meta, deps);
  registerMetaExperimentCommand(meta, deps);
}
