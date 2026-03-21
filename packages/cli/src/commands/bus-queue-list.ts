import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { withErrorHandler } from "../error-handler.js";
import { join } from "node:path";
import { createBroker } from "@mecha/bus";

/** Register the 'bus queue list' subcommand. */
export function registerBusQueueListCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("list")
    .alias("ls")
    .description("List all queues")
    .action(() =>
      withErrorHandler(deps, async () => {
        const busDir = join(deps.mechaDir, "bus");
        const broker = createBroker(busDir);
        const names = broker.queueNames();

        if (names.length === 0) {
          deps.formatter.info("No queues found");
          return;
        }

        deps.formatter.table(
          ["Name"],
          names.map((n) => [n]),
        );
      }),
    );
}
