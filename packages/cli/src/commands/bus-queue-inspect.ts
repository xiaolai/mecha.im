import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { withErrorHandler } from "../error-handler.js";
import { join } from "node:path";
import { createBroker } from "@mecha/bus";

/** Register the 'bus queue inspect' subcommand. */
export function registerBusQueueInspectCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("inspect")
    .description("Show pending/inflight/dead counts for a queue")
    .argument("<name>", "Queue name")
    .action((name: string) =>
      withErrorHandler(deps, async () => {
        const busDir = join(deps.mechaDir, "bus");
        const broker = createBroker(busDir);
        const q = broker.queue(name);
        const stats = q.stats();

        deps.formatter.table(
          ["Metric", "Count"],
          [
            ["pending", String(stats.pending)],
            ["inflight", String(stats.inflight)],
            ["dead", String(stats.dead)],
          ],
        );
      }),
    );
}
