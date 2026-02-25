import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { casaName, MechaError } from "@mecha/core";
import { casaSchedulePause } from "@mecha/service";

export function registerSchedulePauseCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("pause")
    .description("Pause a schedule (or all schedules)")
    .argument("<casa>", "CASA name")
    .argument("[schedule-id]", "Schedule ID (omit to pause all)")
    .action(async (casa: string, scheduleId?: string) => {
      try {
        const name = casaName(casa);
        await casaSchedulePause(deps.processManager, name, scheduleId);
        const target = scheduleId ? `"${scheduleId}"` : "all schedules";
        deps.formatter.success(`Paused ${target} on ${casa}`);
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
