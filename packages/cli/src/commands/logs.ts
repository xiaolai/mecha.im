import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { casaName } from "@mecha/core";
import { casaLogs } from "@mecha/service";

export function registerLogsCommand(program: Command, deps: CommandDeps): void {
  program
    .command("logs")
    .description("View CASA logs")
    .argument("<name>", "CASA name")
    .option("-f, --follow", "Follow log output (not yet implemented)")
    .option("-n, --tail <lines>", "Number of lines to show (not yet implemented)")
    .action(async (name: string, opts: { follow?: boolean; tail?: string }) => {
      const validated = casaName(name);
      const tail = opts.tail ? Number(opts.tail) : undefined;
      if (opts.tail && (!Number.isInteger(tail) || tail! < 1)) {
        deps.formatter.error("Tail must be a positive integer");
        process.exitCode = 1;
        return;
      }
      const stream = casaLogs(deps.processManager, validated, {
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
    });
}
