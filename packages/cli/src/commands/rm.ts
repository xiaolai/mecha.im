import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { mechaRm } from "@mecha/service";
import { toUserMessage, toExitCode } from "@mecha/contracts";

export function registerRmCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("rm <id>")
    .description("Remove a Mecha by ID")
    .option("--with-state", "Also remove the state volume")
    .option("-f, --force", "Force remove even if running")
    .action(async (id: string, cmdOpts: { withState?: boolean; force?: boolean }) => {
      const { processManager, formatter } = deps;
      try {
        await mechaRm(processManager, { id, withState: cmdOpts.withState ?? false, force: cmdOpts.force ?? false });
        formatter.success(`Mecha '${id}' removed.`);
      } catch (err) {
        formatter.error(toUserMessage(err));
        process.exitCode = toExitCode(err);
      }
    });
}
