import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { nodeInit } from "@mecha/service";

/** Register the 'node init' subcommand. */
export function registerNodeInitCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("init")
    .description("Initialize this machine as a named node")
    .option("--name <name>", "Node name (auto-generated if omitted)")
    .action((opts: { name?: string }) => {
      const result = nodeInit(deps.mechaDir, { name: opts.name });
      if (result.created) {
        deps.formatter.success(`Node initialized: ${result.name}`);
      } else {
        deps.formatter.info(`Node already initialized: ${result.name}`);
      }
    });
}
