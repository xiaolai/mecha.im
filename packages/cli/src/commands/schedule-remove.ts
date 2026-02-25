import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { casaName, MechaError } from "@mecha/core";
import { casaScheduleRemove } from "@mecha/service";

export function registerScheduleRemoveCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("remove")
    .alias("rm")
    .description("Remove a schedule from a CASA")
    .argument("<casa>", "CASA name")
    .argument("<schedule-id>", "Schedule ID to remove")
    .action(async (casa: string, scheduleId: string) => {
      try {
        const name = casaName(casa);
        await casaScheduleRemove(deps.processManager, name, scheduleId);
        deps.formatter.success(`Schedule "${scheduleId}" removed from ${casa}`);
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
