import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { botName } from "@mecha/core";
import { withErrorHandler } from "../error-handler.js";

/** Register the 'bot kill' subcommand. */
export function registerBotKillCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("kill")
    .description("Kill one or more bot processes")
    .argument("<name...>", "bot name(s)")
    .action(async (names: string[]) => withErrorHandler(deps, async () => {
      for (const name of names) {
        const validated = botName(name);
        await deps.processManager.kill(validated);
        deps.formatter.success(`Killed ${name}`);
      }
    }));
}
