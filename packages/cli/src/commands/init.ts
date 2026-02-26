import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { mechaInit } from "@mecha/service";
import { withErrorHandler } from "../error-handler.js";

export function registerInitCommand(program: Command, deps: CommandDeps): void {
  program
    .command("init")
    .description("Initialize mecha directory structure")
    .action(async () => withErrorHandler(deps, async () => {
      const result = mechaInit(deps.mechaDir);
      if (result.created) {
        deps.formatter.success(`Initialized ${result.mechaDir}`);
      } else {
        deps.formatter.info(`Already initialized at ${result.mechaDir}`);
      }
      deps.formatter.info(`Node ID: ${result.nodeId}`);
      /* v8 ignore start -- fingerprint always set when node identity exists */
      if (result.fingerprint) {
        deps.formatter.info(`Node key: ${result.fingerprint}`);
      }
      /* v8 ignore stop */
    }));
}
