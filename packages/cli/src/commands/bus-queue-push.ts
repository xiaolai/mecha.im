import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { withErrorHandler } from "../error-handler.js";
import { join } from "node:path";
import { createBroker } from "@mecha/bus";

/** Register the 'bus queue push' subcommand. */
export function registerBusQueuePushCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("push")
    .description("Push a message onto a queue")
    .argument("<queue>", "Queue name")
    .argument("<message>", "Message payload (string or JSON)")
    .action((queue: string, message: string) =>
      withErrorHandler(deps, async () => {
        const busDir = join(deps.mechaDir, "bus");
        const broker = createBroker(busDir);
        const q = broker.queue(queue);

        let payload: unknown = message;
        try {
          payload = JSON.parse(message);
        } catch {
          // Use as plain string
        }

        const id = q.push({ sender: "cli", payload });
        deps.formatter.success(`Pushed message ${id} onto queue "${queue}"`);
      }),
    );
}
