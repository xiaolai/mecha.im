import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { botName, BotBusyError } from "@mecha/core";
import { checkBotBusy } from "@mecha/service";
import { withErrorHandler } from "../error-handler.js";

export function registerBotStopCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("stop")
    .description("Stop a bot process (graceful)")
    .argument("<name>", "bot name")
    .option("--force", "Stop even if bot has active sessions", false)
    .action(async (name: string, opts: { force: boolean }) => withErrorHandler(deps, async () => {
      const validated = botName(name);

      if (!opts.force) {
        const check = await checkBotBusy(deps.processManager, validated);
        if (check.busy) {
          throw new BotBusyError(validated, check.activeSessions);
        }
      }

      await deps.processManager.stop(validated);
      deps.formatter.success(`Stopped ${name}`);
    }));
}
