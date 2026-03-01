import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { casaName, readCasaConfig, CasaNotFoundError, CasaAlreadyRunningError } from "@mecha/core";
import { join } from "node:path";
import { withErrorHandler } from "../error-handler.js";

export function registerCasaStartCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("start")
    .description("Start a stopped CASA from its persisted config")
    .argument("<name>", "CASA name")
    .action(async (name: string) => withErrorHandler(deps, async () => {
      const validated = casaName(name);
      const casaDir = join(deps.mechaDir, validated);
      const config = readCasaConfig(casaDir);
      if (!config) {
        throw new CasaNotFoundError(validated);
      }

      // Check CASA is not already running
      const existing = deps.processManager.get(validated);
      if (existing?.state === "running") {
        throw new CasaAlreadyRunningError(validated);
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
