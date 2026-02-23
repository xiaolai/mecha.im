import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { mechaLogs } from "@mecha/service";
import { toUserMessage, toExitCode } from "@mecha/contracts";

export function registerLogsCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("logs <id>")
    .description("Show logs for a Mecha")
    .option("-f, --follow", "Follow log output")
    .option("-n, --tail <lines>", "Number of lines to show from the end", "100")
    .option("--since <time>", "Show logs since timestamp or relative time")
    .action(async (id: string, cmdOpts: { follow?: boolean; tail: string; since?: string }) => {
      const { processManager, formatter } = deps;
      const tail = parseInt(cmdOpts.tail, 10);
      if (!Number.isInteger(tail) || tail < 0) {
        formatter.error(`Invalid --tail value: ${cmdOpts.tail}`);
        process.exitCode = 1;
        return;
      }
      let since: number | undefined;
      if (cmdOpts.since) {
        since = Math.floor(new Date(cmdOpts.since).getTime() / 1000);
        if (Number.isNaN(since)) {
          formatter.error(`Invalid --since value: ${cmdOpts.since}`);
          process.exitCode = 1;
          return;
        }
      }

      try {
        const stream = await mechaLogs(processManager, { id, follow: cmdOpts.follow ?? false, tail, since });
        stream.on("data", (chunk: Buffer) => process.stdout.write(chunk));
        stream.on("error", (err: Error) => {
          formatter.error(err.message);
          process.exitCode = 1;
        });
        if (cmdOpts.follow) {
          process.on("SIGINT", () => {
            (stream as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.();
            process.exit(0);
          });
        }
      } catch (err) {
        formatter.error(toUserMessage(err));
        process.exitCode = toExitCode(err);
      }
    });
}
