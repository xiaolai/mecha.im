import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { casaName } from "@mecha/core";
import { casaScheduleRun } from "@mecha/service";
import { withErrorHandler } from "../error-handler.js";

export function registerScheduleRunCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("run")
    .description("Trigger a schedule immediately")
    .argument("<casa>", "CASA name")
    .argument("<schedule-id>", "Schedule ID to trigger")
    .action((casa: string, scheduleId: string) =>
      withErrorHandler(deps, async () => {
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
      }),
    );
}
