import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import type { CasaName } from "@mecha/core";
import { casaKill } from "@mecha/service";

export function registerKillCommand(program: Command, deps: CommandDeps): void {
  program
    .command("kill")
    .description("Kill a CASA process")
    .argument("<name>", "CASA name")
    .action(async (name: string) => {
      await casaKill(deps.processManager, name as CasaName);
      deps.formatter.success(`Killed ${name}`);
    });
}
