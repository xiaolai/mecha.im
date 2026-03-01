import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { casaName } from "@mecha/core";
import { withErrorHandler } from "../error-handler.js";

export function registerCasaKillCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("kill")
    .description("Kill a CASA process")
    .argument("<name>", "CASA name")
    .action(async (name: string) => withErrorHandler(deps, async () => {
      const validated = casaName(name);
      await deps.processManager.kill(validated);
      deps.formatter.success(`Killed ${name}`);
    }));
}
