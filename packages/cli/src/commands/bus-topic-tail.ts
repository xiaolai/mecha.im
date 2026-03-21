import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { withErrorHandler } from "../error-handler.js";
import { join } from "node:path";
import { createBroker } from "@mecha/bus";
import { existsSync, readFileSync } from "node:fs";
import type { BusMessage } from "@mecha/bus";

/** Register the 'bus topic tail' subcommand. */
export function registerBusTopicTailCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("tail")
    .description("Show last N messages from a topic")
    .argument("<topic>", "Topic name")
    .option("-n, --lines <count>", "Number of messages to show", "10")
    .action((topic: string, opts: { lines: string }) =>
      withErrorHandler(deps, async () => {
        const count = parseInt(opts.lines, 10);
        if (isNaN(count) || count < 1) {
          deps.formatter.error("Lines must be a positive integer");
          process.exitCode = 1;
          return;
        }

        const busDir = join(deps.mechaDir, "bus");
        // Ensure broker knows about the topic
        createBroker(busDir);

        const messagesPath = join(busDir, "topics", topic, "messages.jsonl");
        if (!existsSync(messagesPath)) {
          deps.formatter.info(`No messages in topic "${topic}"`);
          return;
        }

        const content = readFileSync(messagesPath, "utf-8").trim();
        if (!content) {
          deps.formatter.info(`No messages in topic "${topic}"`);
          return;
        }

        const messages: BusMessage[] = content
          .split("\n")
          .map((line) => JSON.parse(line) as BusMessage);

        const tail = messages.slice(-count);

        deps.formatter.table(
          ["ID", "Timestamp", "Sender", "Payload"],
          tail.map((m) => [
            m.id,
            m.ts,
            m.sender,
            typeof m.payload === "string"
              ? m.payload.length > 50 ? m.payload.slice(0, 47) + "..." : m.payload
              : JSON.stringify(m.payload),
          ]),
        );
      }),
    );
}
