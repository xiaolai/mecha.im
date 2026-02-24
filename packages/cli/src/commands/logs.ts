import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import type { CasaName } from "@mecha/core";
import { casaLogs } from "@mecha/service";

export function registerLogsCommand(program: Command, deps: CommandDeps): void {
  program
    .command("logs")
    .description("View CASA logs")
    .argument("<name>", "CASA name")
    .option("-f, --follow", "Follow log output")
    .option("-n, --tail <lines>", "Number of lines to show")
    .action(async (name: string, opts: { follow?: boolean; tail?: string }) => {
      const stream = casaLogs(deps.processManager, name as CasaName, {
        follow: opts.follow,
        tail: opts.tail ? Number(opts.tail) : undefined,
      });
      stream.on("data", (chunk: Buffer) => {
        process.stdout.write(chunk);
      });
      await new Promise<void>((resolve) => {
        stream.on("end", resolve);
      });
    });
}
