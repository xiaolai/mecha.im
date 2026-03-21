import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { botName, BotNotFoundError, BotBusyError } from "@mecha/core";
import { checkBotBusy } from "@mecha/service";
import { join } from "node:path";
import { existsSync, rmSync } from "node:fs";
import { withErrorHandler } from "../error-handler.js";

/** Register the 'bot remove' subcommand. */
export function registerBotRemoveCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("remove")
    .description("Stop and delete one or more bots (config, logs, sessions)")
    .argument("<name...>", "bot name(s)")
    .option("--force", "Force kill instead of graceful stop", false)
    .action(async (names: string[], opts: { force: boolean }) => withErrorHandler(deps, async () => {
      for (const name of names) {
        const validated = botName(name);
        const botDir = join(deps.mechaDir, validated);

        if (!existsSync(botDir)) {
          throw new BotNotFoundError(validated);
        }

        // Stop if running (check for active sessions unless --force)
        const existing = deps.processManager.get(validated);
        if (existing?.state === "running") {
          if (!opts.force) {
            const check = await checkBotBusy(deps.processManager, validated);
            /* v8 ignore start -- busy check requires active sessions on bot */
            if (check.busy) {
              throw new BotBusyError(validated, check.activeSessions);
            }
            /* v8 ignore stop */
            await deps.processManager.stop(validated);
          } else {
            await deps.processManager.kill(validated);
          }
        }

        // Delete entire bot directory
        rmSync(botDir, { recursive: true, force: true });
        deps.formatter.success(`Removed ${validated}`);
      }
    }));
}
