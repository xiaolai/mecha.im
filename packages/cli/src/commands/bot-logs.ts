import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { botName } from "@mecha/core";
import { withErrorHandler } from "../error-handler.js";

/** Register the 'bot logs' subcommand. */
export function registerBotLogsCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("logs")
    .description("View bot logs")
    .argument("<name>", "bot name")
    .option("-f, --follow", "Follow log output")
    .option("-n, --tail <lines>", "Number of lines to show")
    .action(async (name: string, opts: { follow?: boolean; tail?: string }) => withErrorHandler(deps, async () => {
      const validated = botName(name);
      const tail = opts.tail ? Number(opts.tail) : undefined;
      if (opts.tail && (!Number.isInteger(tail) || tail! < 1)) {
        deps.formatter.error("Tail must be a positive integer");
        process.exitCode = 1;
        return;
      }
      const stream = deps.processManager.logs(validated, {
        follow: opts.follow,
        tail,
      });
      await new Promise<void>((resolve, reject) => {
        stream.on("data", (chunk: Buffer | string) => {
          process.stdout.write(chunk);
        });
        stream.on("end", () => resolve());
        /* v8 ignore start -- stream error only on I/O failure */
        stream.on("error", (err) => reject(err));
        /* v8 ignore stop */
      });
    }));
}
