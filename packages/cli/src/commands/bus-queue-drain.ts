import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { withErrorHandler } from "../error-handler.js";
import { join } from "node:path";
import { createBroker } from "@mecha/bus";

/** Register the 'bus queue drain' subcommand. */
export function registerBusQueueDrainCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("drain")
    .description("Move all pending messages to dead letter")
    .argument("<name>", "Queue name")
    .action((name: string) =>
      withErrorHandler(deps, async () => {
        const busDir = join(deps.mechaDir, "bus");
        const broker = createBroker(busDir);
        const q = broker.queue(name);
        const count = q.drain();

        if (count === 0) {
          deps.formatter.info(`Queue "${name}" has no pending messages`);
          return;
        }

        deps.formatter.success(`Drained ${count} message(s) from queue "${name}" to dead letter`);
      }),
    );
}
