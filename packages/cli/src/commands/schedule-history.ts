import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { botName } from "@mecha/core";
import { botScheduleHistory } from "@mecha/service";
import { withErrorHandler } from "../error-handler.js";

/** Register the 'schedule history' subcommand. */
export function registerScheduleHistoryCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("history")
    .description("Show run history for a schedule")
    .argument("<bot>", "bot name")
    .argument("<schedule-id>", "Schedule ID")
    .option("--limit <n>", "Maximum number of entries", "20")
    .action((bot: string, scheduleId: string, opts: { limit: string }) =>
      withErrorHandler(deps, async () => {
        const name = botName(bot);
        const limit = Number(opts.limit);
        if (!Number.isInteger(limit) || limit < 1) {
          deps.formatter.error(`Invalid limit: "${opts.limit}" (must be a positive integer)`);
          process.exitCode = 1;
          return;
        }
        const history = await botScheduleHistory(deps.processManager, name, scheduleId, limit);

        if (history.length === 0) {
          deps.formatter.info("No run history");
          return;
        }

        deps.formatter.table(
          ["Started", "Duration", "Outcome", "Error"],
          history.map((r) => [
            r.startedAt,
            `${r.durationMs}ms`,
            r.outcome,
            r.error ?? "",
          ]),
        );
      }),
    );
}
