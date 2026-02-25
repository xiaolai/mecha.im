import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { casaName, MechaError } from "@mecha/core";
import { casaScheduleRun } from "@mecha/service";

export function registerScheduleRunCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("run")
    .description("Trigger a schedule immediately")
    .argument("<casa>", "CASA name")
    .argument("<schedule-id>", "Schedule ID to trigger")
    .action(async (casa: string, scheduleId: string) => {
      try {
        const name = casaName(casa);
        const result = await casaScheduleRun(deps.processManager, name, scheduleId);
        if (result.outcome === "success") {
          deps.formatter.success(`Run completed (${result.durationMs}ms)`);
        } else if (result.outcome === "skipped") {
          deps.formatter.warn(`Run skipped: ${result.error}`);
        } else {
          deps.formatter.error(`Run failed: ${result.error}`);
          process.exitCode = 1;
        }
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
