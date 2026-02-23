import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { mechaLs } from "@mecha/service";
import { toUserMessage, toExitCode } from "@mecha/contracts";

export function registerLsCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("ls")
    .description("List all mecha containers")
    .action(async () => {
      const { processManager, formatter } = deps;
      const jsonMode = parent.opts().json ?? false;

      try {
        const items = await mechaLs(processManager);

        if (jsonMode) {
          formatter.json(items);
          return;
        }

        const rows = items.map(({ id, state, status, path }) => ({
          ID: id, STATE: state, STATUS: status, PATH: path,
        }));
        formatter.table(rows, ["ID", "STATE", "STATUS", "PATH"]);
      } catch (err) {
        formatter.error(toUserMessage(err));
        process.exitCode = toExitCode(err);
      }
    });
}
