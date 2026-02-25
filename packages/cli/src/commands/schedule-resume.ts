import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { casaName } from "@mecha/core";
import { casaScheduleResume } from "@mecha/service";
import { withErrorHandler } from "../error-handler.js";

export function registerScheduleResumeCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("resume")
    .description("Resume a schedule (or all schedules)")
    .argument("<casa>", "CASA name")
    .argument("[schedule-id]", "Schedule ID (omit to resume all)")
    .action((casa: string, scheduleId?: string) =>
      withErrorHandler(deps, async () => {
        const name = casaName(casa);
        await casaScheduleResume(deps.processManager, name, scheduleId);
        const target = scheduleId ? `"${scheduleId}"` : "all schedules";
        deps.formatter.success(`Resumed ${target} on ${casa}`);
      }),
    );
}
