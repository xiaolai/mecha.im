import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { botName } from "@mecha/core";
import { botScheduleRemove } from "@mecha/service";
import { withErrorHandler } from "../error-handler.js";

export function registerScheduleRemoveCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("remove")
    .alias("rm")
    .description("Remove a schedule from a bot")
    .argument("<bot>", "bot name")
    .argument("<schedule-id>", "Schedule ID to remove")
    .action((bot: string, scheduleId: string) =>
      withErrorHandler(deps, async () => {
        const name = botName(bot);
        await botScheduleRemove(deps.processManager, name, scheduleId);
        deps.formatter.success(`Schedule "${scheduleId}" removed from ${bot}`);
      }),
    );
}
