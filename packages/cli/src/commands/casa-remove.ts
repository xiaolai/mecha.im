import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { casaName, CasaNotFoundError } from "@mecha/core";
import { join } from "node:path";
import { existsSync, rmSync } from "node:fs";
import { withErrorHandler } from "../error-handler.js";

export function registerCasaRemoveCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("remove")
    .description("Stop and delete a CASA (config, logs, sessions)")
    .argument("<name>", "CASA name")
    .option("--force", "Force kill instead of graceful stop", false)
    .action(async (name: string, opts: { force: boolean }) => withErrorHandler(deps, async () => {
      const validated = casaName(name);
      const casaDir = join(deps.mechaDir, validated);

      if (!existsSync(casaDir)) {
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

      // Delete entire CASA directory
      rmSync(casaDir, { recursive: true, force: true });
      deps.formatter.success(`Removed ${validated}`);
    }));
}
