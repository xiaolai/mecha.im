import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { mechaToken } from "@mecha/service";
import { toUserMessage, toExitCode } from "@mecha/contracts";

export function registerTokenCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("token <id>")
    .description("Retrieve the auth token for a running Mecha")
    .action(async (id: string) => {
      const { processManager, formatter } = deps;
      const jsonMode = parent.opts().json ?? false;
      try {
        const result = await mechaToken(processManager, id);
        if (jsonMode) {
          formatter.json(result);
        } else {
          formatter.info(result.token);
        }
      } catch (err) {
        formatter.error(toUserMessage(err));
        process.exitCode = toExitCode(err);
      }
    });
}
