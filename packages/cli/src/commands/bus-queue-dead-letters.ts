import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { withErrorHandler } from "../error-handler.js";
import { join } from "node:path";
import { createBroker } from "@mecha/bus";

/** Register the 'bus queue dead-letters' subcommand. */
export function registerBusQueueDeadLettersCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("dead-letters")
    .description("Show dead-letter messages in a queue")
    .argument("<queue>", "Queue name")
    .action((queue: string) =>
      withErrorHandler(deps, async () => {
        const busDir = join(deps.mechaDir, "bus");
        const broker = createBroker(busDir);
        const q = broker.queue(queue);
        const messages = q.deadLetters();
        if (messages.length === 0) {
          deps.formatter.info(`No dead-letter messages in queue "${queue}"`);
          return;
        }
        deps.formatter.table(
          ["ID", "Sender", "Timestamp", "Payload"],
          messages.map((m) => [
            m.id,
            m.sender,
            m.ts,
            typeof m.payload === "string" ? m.payload.slice(0, 80) : JSON.stringify(m.payload).slice(0, 80),
          ]),
        );
      }),
    );
}
