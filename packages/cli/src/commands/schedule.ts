import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { registerScheduleAddCommand } from "./schedule-add.js";
import { registerScheduleListCommand } from "./schedule-list.js";
import { registerScheduleRemoveCommand } from "./schedule-remove.js";
import { registerSchedulePauseCommand } from "./schedule-pause.js";
import { registerScheduleResumeCommand } from "./schedule-resume.js";
import { registerScheduleRunCommand } from "./schedule-run.js";
import { registerScheduleHistoryCommand } from "./schedule-history.js";

/** Register the 'schedule' command group. */
export function registerScheduleCommand(program: Command, deps: CommandDeps): void {
  const schedule = program
    .command("schedule")
    .description("Manage periodic schedules");

  registerScheduleAddCommand(schedule, deps);
  registerScheduleListCommand(schedule, deps);
  registerScheduleRemoveCommand(schedule, deps);
  registerSchedulePauseCommand(schedule, deps);
  registerScheduleResumeCommand(schedule, deps);
  registerScheduleRunCommand(schedule, deps);
  registerScheduleHistoryCommand(schedule, deps);
}
