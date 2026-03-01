import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { casaName } from "@mecha/core";
import { withErrorHandler } from "../error-handler.js";

export function registerCasaStopCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("stop")
    .description("Stop a CASA process (graceful)")
    .argument("<name>", "CASA name")
    .action(async (name: string) => withErrorHandler(deps, async () => {
      const validated = casaName(name);
      await deps.processManager.stop(validated);
      deps.formatter.success(`Stopped ${name}`);
    }));
}
