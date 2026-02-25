import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { casaName } from "@mecha/core";
import { casaSchedulePause } from "@mecha/service";
import { withErrorHandler } from "../error-handler.js";

export function registerSchedulePauseCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("pause")
    .description("Pause a schedule (or all schedules)")
    .argument("<casa>", "CASA name")
    .argument("[schedule-id]", "Schedule ID (omit to pause all)")
    .action((casa: string, scheduleId?: string) =>
      withErrorHandler(deps, async () => {
        const name = casaName(casa);
        await casaSchedulePause(deps.processManager, name, scheduleId);
        const target = scheduleId ? `"${scheduleId}"` : "all schedules";
        deps.formatter.success(`Paused ${target} on ${casa}`);
      }),
    );
}
