import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { casaName } from "@mecha/core";
import { casaScheduleRemove } from "@mecha/service";
import { withErrorHandler } from "../error-handler.js";

export function registerScheduleRemoveCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("remove")
    .alias("rm")
    .description("Remove a schedule from a CASA")
    .argument("<casa>", "CASA name")
    .argument("<schedule-id>", "Schedule ID to remove")
    .action((casa: string, scheduleId: string) =>
      withErrorHandler(deps, async () => {
        const name = casaName(casa);
        await casaScheduleRemove(deps.processManager, name, scheduleId);
        deps.formatter.success(`Schedule "${scheduleId}" removed from ${casa}`);
      }),
    );
}
