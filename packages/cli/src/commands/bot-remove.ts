import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { botName, BotNotFoundError } from "@mecha/core";
import { join } from "node:path";
import { existsSync, rmSync } from "node:fs";
import { withErrorHandler } from "../error-handler.js";

export function registerBotRemoveCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("remove")
    .description("Stop and delete a bot (config, logs, sessions)")
    .argument("<name>", "bot name")
    .option("--force", "Force kill instead of graceful stop", false)
    .action(async (name: string, opts: { force: boolean }) => withErrorHandler(deps, async () => {
      const validated = botName(name);
      const botDir = join(deps.mechaDir, validated);

      if (!existsSync(botDir)) {
        throw new BotNotFoundError(validated);
      }

      // Stop if running
      const existing = deps.processManager.get(validated);
      if (existing?.state === "running") {
        if (opts.force) {
          await deps.processManager.kill(validated);
        } else {
          await deps.processManager.stop(validated);
        }
      }

      // Delete entire bot directory
      rmSync(botDir, { recursive: true, force: true });
      deps.formatter.success(`Removed ${validated}`);
    }));
}
