import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { casaName } from "@mecha/core";
export function registerKillCommand(program: Command, deps: CommandDeps): void {
  program
    .command("kill")
    .description("Kill a CASA process")
    .argument("<name>", "CASA name")
    .action(async (name: string) => {
      const validated = casaName(name);
      await deps.processManager.kill(validated);
      deps.formatter.success(`Killed ${name}`);
    });
}
