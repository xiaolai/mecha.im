import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { withErrorHandler } from "../error-handler.js";
import { join } from "node:path";
import { createBroker } from "@mecha/bus";

/** Register the 'bus queue nack' subcommand. */
export function registerBusQueueNackCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("nack")
    .description("Return a claimed queue item for retry or dead-letter")
    .argument("<queue>", "Queue name")
    .argument("<messageId>", "Message ID to nack")
    .action((queue: string, messageId: string) =>
      withErrorHandler(deps, async () => {
        const busDir = join(deps.mechaDir, "bus");
        const broker = createBroker(busDir);
        const q = broker.queue(queue);
        const nacked = q.nack(messageId);
        if (!nacked) {
          deps.formatter.error(`Message "${messageId}" not found in inflight for queue "${queue}"`);
          process.exitCode = 1;
          return;
        }
        deps.formatter.success(`Nacked message "${messageId}" in queue "${queue}"`);
      }),
    );
}
