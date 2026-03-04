import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { botName } from "@mecha/core";
import { botSchedulePause } from "@mecha/service";
import { withErrorHandler } from "../error-handler.js";

export function registerSchedulePauseCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("pause")
    .description("Pause a schedule (or all schedules)")
    .argument("<bot>", "bot name")
    .argument("[schedule-id]", "Schedule ID (omit to pause all)")
    .action((bot: string, scheduleId?: string) =>
      withErrorHandler(deps, async () => {
        const name = botName(bot);
        await botSchedulePause(deps.processManager, name, scheduleId);
        const target = scheduleId ? `"${scheduleId}"` : "all schedules";
        deps.formatter.success(`Paused ${target} on ${bot}`);
      }),
    );
}
