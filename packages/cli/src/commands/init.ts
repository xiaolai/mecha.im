import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { mechaInit } from "@mecha/service";

export function registerInitCommand(program: Command, deps: CommandDeps): void {
  program
    .command("init")
    .description("Initialize mecha directory structure")
    .action(async () => {
      const result = mechaInit(deps.mechaDir);
      if (result.created) {
        deps.formatter.success(`Initialized ${result.mechaDir}`);
      } else {
        deps.formatter.info(`Already initialized at ${result.mechaDir}`);
      }
      deps.formatter.info(`Node ID: ${result.nodeId}`);
    });
}
