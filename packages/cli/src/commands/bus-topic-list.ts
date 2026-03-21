import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { withErrorHandler } from "../error-handler.js";
import { join } from "node:path";
import { createBroker } from "@mecha/bus";

/** Register the 'bus topic list' subcommand. */
export function registerBusTopicListCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("list")
    .alias("ls")
    .description("List all topics")
    .action(() =>
      withErrorHandler(deps, async () => {
        const busDir = join(deps.mechaDir, "bus");
        const broker = createBroker(busDir);
        const names = broker.topicNames();

        if (names.length === 0) {
          deps.formatter.info("No topics found");
          return;
        }

        deps.formatter.table(
          ["Name"],
          names.map((n) => [n]),
        );
      }),
    );
}
