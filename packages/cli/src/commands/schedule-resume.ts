import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { casaName, MechaError } from "@mecha/core";
import { casaScheduleResume } from "@mecha/service";

export function registerScheduleResumeCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("resume")
    .description("Resume a schedule (or all schedules)")
    .argument("<casa>", "CASA name")
    .argument("[schedule-id]", "Schedule ID (omit to resume all)")
    .action(async (casa: string, scheduleId?: string) => {
      try {
        const name = casaName(casa);
        await casaScheduleResume(deps.processManager, name, scheduleId);
        const target = scheduleId ? `"${scheduleId}"` : "all schedules";
        deps.formatter.success(`Resumed ${target} on ${casa}`);
      /* v8 ignore start -- MechaError forwarding */
      } catch (err) {
        if (err instanceof MechaError) {
          deps.formatter.error(err.message);
          process.exitCode = err.exitCode;
        } else {
          throw err;
        }
      }
      /* v8 ignore stop */
    });
}
