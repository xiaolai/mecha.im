import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { mechaStatus } from "@mecha/service";
import { toUserMessage, toExitCode } from "@mecha/contracts";

export function registerStatusCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("status <id>")
    .description("Show status of a Mecha")
    .option("-w, --watch", "Watch for status changes")
    .action(async (id: string, cmdOpts: { watch?: boolean }) => {
      const { processManager, formatter } = deps;
      const jsonMode = parent.opts().json ?? false;

      const printStatus = async (): Promise<void> => {
        try {
          const status = await mechaStatus(processManager, id);

          if (jsonMode) {
            formatter.json(status);
          } else {
            const f = (label: string, val: unknown) => formatter.info(`${label.padEnd(10)}${val}`);
            f("ID:", status.id);
            f("Name:", status.name);
            f("State:", status.state);
            f("Running:", status.running);
            f("Started:", status.startedAt ?? "");
            f("Path:", status.path);
          }
        } catch (err) {
          formatter.error(toUserMessage(err));
          process.exitCode = toExitCode(err);
        }
      };

      if (cmdOpts.watch) {
        process.on("SIGINT", () => process.exit(0));
        let consecutiveErrors = 0;
        while (true) {
          await printStatus();
          if (process.exitCode) {
            consecutiveErrors++;
            if (consecutiveErrors >= 3) break; // Stop after 3 consecutive errors
          } else {
            consecutiveErrors = 0;
          }
          const delay = Math.min(2000 * (1 + consecutiveErrors), 10000);
          await new Promise((r) => setTimeout(r, delay));
        }
      } else {
        await printStatus();
      }
    });
}
