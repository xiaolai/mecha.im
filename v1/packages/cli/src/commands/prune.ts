import { createInterface } from "node:readline";
import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { mechaPrune, mechaLs } from "@mecha/service";
import { toUserMessage, toExitCode } from "@mecha/contracts";

async function confirm(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y");
    });
  });
}

export function registerPruneCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("prune")
    .description("Remove all stopped Mechas")
    .option("-f, --force", "Skip confirmation prompt")
    .action(async (cmdOpts: { force?: boolean }) => {
      const { processManager, formatter } = deps;
      const jsonMode = parent.opts().json ?? false;
      try {
        if (!cmdOpts.force) {
          const items = await mechaLs(processManager);
          const PRUNABLE_STATES = new Set(["stopped", "exited", "dead"]);
          const stoppedCount = items.filter((i) => PRUNABLE_STATES.has(i.state)).length;
          if (stoppedCount === 0) {
            formatter.info("No stopped Mechas to remove.");
            return;
          }
          const ok = await confirm(`Remove ${stoppedCount} stopped Mecha(s)?`);
          if (!ok) {
            formatter.info("Aborted.");
            return;
          }
        }
        const result = await mechaPrune(processManager);
        if (jsonMode) {
          formatter.json(result);
        } else {
          formatter.success(
            `Removed ${result.removedProcesses.length} process(es).`,
          );
        }
      } catch (err) {
        formatter.error(toUserMessage(err));
        process.exitCode = toExitCode(err);
      }
    });
}
