import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { withErrorHandler } from "../error-handler.js";
import { join } from "node:path";
import { createBroker } from "@mecha/bus";

/** Register the 'bus queue create' subcommand. */
export function registerBusQueueCreateCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("create")
    .description("Create a new durable queue")
    .argument("<name>", "Queue name")
    .option("--max-retries <count>", "Maximum retry attempts", "3")
    .action((name: string, opts: { maxRetries: string }) =>
      withErrorHandler(deps, async () => {
        const maxRetries = parseInt(opts.maxRetries, 10);
        if (isNaN(maxRetries) || maxRetries < 0) {
          deps.formatter.error("Max retries must be a non-negative integer");
          process.exitCode = 1;
          return;
        }

        const busDir = join(deps.mechaDir, "bus");
        const broker = createBroker(busDir);
        broker.queue(name, { maxRetries });
        deps.formatter.success(`Queue "${name}" created (maxRetries: ${maxRetries})`);
      }),
    );
}
