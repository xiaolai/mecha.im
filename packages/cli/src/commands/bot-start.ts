import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { botName, readBotConfig, BotNotFoundError, BotAlreadyRunningError } from "@mecha/core";
import { join } from "node:path";
import { withErrorHandler } from "../error-handler.js";

export function registerBotStartCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("start")
    .description("Start a stopped bot from its persisted config")
    .argument("<name>", "bot name")
    .action(async (name: string) => withErrorHandler(deps, async () => {
      const validated = botName(name);
      const botDir = join(deps.mechaDir, validated);
      const config = readBotConfig(botDir);
      if (!config) {
        throw new BotNotFoundError(validated);
      }

      // Check bot is not already running
      const existing = deps.processManager.get(validated);
      if (existing?.state === "running") {
        throw new BotAlreadyRunningError(validated);
      }

      const info = await deps.processManager.spawn({
        name: validated,
        workspacePath: config.workspace,
        port: config.port,
        auth: config.auth ?? undefined,
        tags: config.tags,
        expose: config.expose,
        sandboxMode: config.sandboxMode,
        model: config.model,
        permissionMode: config.permissionMode,
      });
      deps.formatter.success(`Started ${info.name} on port ${info.port}`);
    }));
}
