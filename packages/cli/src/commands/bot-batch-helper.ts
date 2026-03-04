import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { batchBotAction } from "@mecha/service";
import { withErrorHandler } from "../error-handler.js";

interface BatchOpts {
  force: boolean;
  idleOnly: boolean;
  dryRun: boolean;
}

export function registerBatchCommand(
  parent: Command,
  deps: CommandDeps,
  config: { name: string; description: string; action: "stop" | "restart"; verb: string },
): void {
  parent
    .command(config.name)
    .description(config.description)
    .option("--force", "Bypass busy check entirely", false)
    .option("--idle-only", "Skip busy bots instead of failing", false)
    .option("--dry-run", "Show what would happen without executing", false)
    .action(async (opts: BatchOpts) => withErrorHandler(deps, async () => {
      const result = await batchBotAction({
        pm: deps.processManager,
        mechaDir: deps.mechaDir,
        action: config.action,
        force: opts.force,
        idleOnly: opts.idleOnly,
        dryRun: opts.dryRun,
      });

      if (deps.formatter.isJson) {
        deps.formatter.json(result);
        return;
      }

      if (result.results.length === 0) {
        deps.formatter.info(`No bots to ${config.action}`);
        return;
      }

      if (opts.dryRun) {
        deps.formatter.info("Dry run — no changes made");
      }

      deps.formatter.table(
        ["Name", "Status", "Details"],
        result.results.map((r) => [
          r.name,
          r.status,
          r.error ?? (r.activeSessions ? `${r.activeSessions} active session(s)` : ""),
        ]),
      );

      const { succeeded, skipped, failed } = result.summary;
      deps.formatter.info(`${config.verb} ${succeeded}, skipped ${skipped}, failed ${failed}`);

      if (failed > 0) {
        process.exitCode = 1;
      }
    }));
}
