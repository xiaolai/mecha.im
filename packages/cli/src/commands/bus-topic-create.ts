import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { withErrorHandler } from "../error-handler.js";
import { join } from "node:path";
import { createBroker } from "@mecha/bus";

/** Register the 'bus topic create' subcommand. */
export function registerBusTopicCreateCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("create")
    .description("Create a new topic")
    .argument("<name>", "Topic name")
    .action((name: string) =>
      withErrorHandler(deps, async () => {
        const busDir = join(deps.mechaDir, "bus");
        const broker = createBroker(busDir);
        broker.topic(name);
        deps.formatter.success(`Topic "${name}" created`);
      }),
    );
}
