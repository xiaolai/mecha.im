import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { botName } from "@mecha/core";
import { botScheduleList } from "@mecha/service";
import { withErrorHandler } from "../error-handler.js";

export function registerScheduleListCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("list")
    .alias("ls")
    .description("List schedules for a bot")
    .argument("<bot>", "bot name")
    .action((bot: string) =>
      withErrorHandler(deps, async () => {
        const name = botName(bot);
        const schedules = await botScheduleList(deps.processManager, name);

        if (schedules.length === 0) {
          deps.formatter.info("No schedules configured");
          return;
        }

        deps.formatter.table(
          ["ID", "Every", "Prompt", "Paused"],
          schedules.map((s) => [
            s.id,
            s.trigger.every,
            s.prompt.length > 50 ? s.prompt.slice(0, 47) + "..." : s.prompt,
            s.paused ? "yes" : "no",
          ]),
        );
      }),
    );
}
