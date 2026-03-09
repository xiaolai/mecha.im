import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { botName } from "@mecha/core";
import { botScheduleResume } from "@mecha/service";
import { withErrorHandler } from "../error-handler.js";

/** Register the 'schedule resume' subcommand. */
export function registerScheduleResumeCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("resume")
    .description("Resume a schedule (or all schedules)")
    .argument("<bot>", "bot name")
    .argument("[schedule-id]", "Schedule ID (omit to resume all)")
    .action((bot: string, scheduleId?: string) =>
      withErrorHandler(deps, async () => {
        const name = botName(bot);
        await botScheduleResume(deps.processManager, name, scheduleId);
        const target = scheduleId ? `"${scheduleId}"` : "all schedules";
        deps.formatter.success(`Resumed ${target} on ${bot}`);
      }),
    );
}
