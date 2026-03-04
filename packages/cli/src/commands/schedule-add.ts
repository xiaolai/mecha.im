import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { botName } from "@mecha/core";
import { botScheduleAdd } from "@mecha/service";
import { withErrorHandler } from "../error-handler.js";

export function registerScheduleAddCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("add")
    .description("Add a periodic schedule to a bot")
    .argument("<bot>", "bot name")
    .requiredOption("--id <id>", "Schedule ID (lowercase, alphanumeric, hyphens)")
    .requiredOption("--every <interval>", 'Interval (e.g. "30s", "5m", "1h")')
    .requiredOption("--prompt <prompt>", "Prompt to send on each run")
    .action((bot: string, opts: { id: string; every: string; prompt: string }) =>
      withErrorHandler(deps, async () => {
        const name = botName(bot);
        await botScheduleAdd(deps.processManager, name, {
          id: opts.id,
          every: opts.every,
          prompt: opts.prompt,
        });
        deps.formatter.success(`Schedule "${opts.id}" added to ${bot} (every ${opts.every})`);
      }),
    );
}
