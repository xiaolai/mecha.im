import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { botName, readBotConfig, BotNotFoundError, BotBusyError } from "@mecha/core";
import { checkBotBusy } from "@mecha/service";
import { checkPort } from "@mecha/process";
import { join } from "node:path";
import { withErrorHandler } from "../error-handler.js";

/** Wait until a port is free (max ~5s). */
async function waitForPortFree(port: number, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await checkPort(port)) return;
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** Register the 'bot restart' subcommand. */
export function registerBotRestartCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("restart")
    .description("Restart a bot (stop + re-spawn from config)")
    .argument("<name>", "bot name")
    .option("--force", "Force kill instead of graceful stop", false)
    .action(async (name: string, opts: { force: boolean }) => withErrorHandler(deps, async () => {
      const validated = botName(name);
      const botDir = join(deps.mechaDir, validated);

      // Read config BEFORE stopping — fail fast if missing
      const config = readBotConfig(botDir);
      if (!config) {
        throw new BotNotFoundError(validated);
      }

      // Stop if running
      const existing = deps.processManager.get(validated);
      if (existing?.state === "running") {
        if (!opts.force) {
          const check = await checkBotBusy(deps.processManager, validated);
          if (check.busy) {
            throw new BotBusyError(validated, check.activeSessions);
          }
        }

        if (opts.force) {
          await deps.processManager.kill(validated);
        } else {
          await deps.processManager.stop(validated);
        }
      }

      // Wait for port to be released before re-spawning
      if (config.port) {
        await waitForPortFree(config.port);
      }

      // Re-spawn from config
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
      deps.formatter.success(`Restarted ${info.name} on port ${info.port}`);
    }));
}
