import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { casaName, readCasaConfig, CasaNotFoundError } from "@mecha/core";
import { join } from "node:path";
import { withErrorHandler } from "../error-handler.js";

export function registerCasaRestartCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("restart")
    .description("Restart a CASA (stop + re-spawn from config)")
    .argument("<name>", "CASA name")
    .option("--force", "Force kill instead of graceful stop", false)
    .action(async (name: string, opts: { force: boolean }) => withErrorHandler(deps, async () => {
      const validated = casaName(name);
      const casaDir = join(deps.mechaDir, validated);

      // Read config BEFORE stopping — fail fast if missing
      const config = readCasaConfig(casaDir);
      if (!config) {
        throw new CasaNotFoundError(validated);
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
