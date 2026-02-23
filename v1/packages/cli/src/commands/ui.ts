import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { resolveUiUrl } from "@mecha/service";
import { toUserMessage, toExitCode } from "@mecha/contracts";

export function registerUiCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("ui <id>")
    .description("Print the UI URL for a Mecha")
    .action(async (id: string) => {
      const { processManager, formatter } = deps;
      try {
        const result = await resolveUiUrl(processManager, id);
        formatter.info(result.url);
      } catch (err) {
        formatter.error(toUserMessage(err));
        process.exitCode = toExitCode(err);
      }
    });
}
