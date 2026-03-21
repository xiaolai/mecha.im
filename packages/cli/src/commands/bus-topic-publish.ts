import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { withErrorHandler } from "../error-handler.js";
import { join } from "node:path";
import { createBroker } from "@mecha/bus";

/** Register the 'bus topic publish' subcommand. */
export function registerBusTopicPublishCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("publish")
    .description("Publish a message to a topic")
    .argument("<topic>", "Topic name")
    .argument("<message>", "Message payload (string or JSON)")
    .action((topic: string, message: string) =>
      withErrorHandler(deps, async () => {
        const busDir = join(deps.mechaDir, "bus");
        const broker = createBroker(busDir);
        const t = broker.topic(topic);

        let payload: unknown = message;
        try {
          payload = JSON.parse(message);
        } catch {
          // Use as plain string
        }

        const id = t.publish({ sender: "cli", payload });
        deps.formatter.success(`Published message ${id} to topic "${topic}"`);
      }),
    );
}
