import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import type { CasaName } from "@mecha/core";
import { casaStatus } from "@mecha/service";

export function registerStatusCommand(program: Command, deps: CommandDeps): void {
  program
    .command("status")
    .description("Show CASA status")
    .argument("<name>", "CASA name")
    .action(async (name: string) => {
      const info = casaStatus(deps.processManager, name as CasaName);
      deps.formatter.json(info);
    });
}
