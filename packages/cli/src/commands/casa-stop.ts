import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { casaName, CasaBusyError } from "@mecha/core";
import { checkCasaBusy } from "@mecha/service";
import { withErrorHandler } from "../error-handler.js";

export function registerCasaStopCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("stop")
    .description("Stop a CASA process (graceful)")
    .argument("<name>", "CASA name")
    .option("--force", "Stop even if CASA has active sessions", false)
    .action(async (name: string, opts: { force: boolean }) => withErrorHandler(deps, async () => {
      const validated = casaName(name);

      if (!opts.force) {
        const check = await checkCasaBusy(deps.processManager, validated);
        if (check.busy) {
          throw new CasaBusyError(validated, check.activeSessions);
        }
      }

      await deps.processManager.stop(validated);
      deps.formatter.success(`Stopped ${name}`);
    }));
}
