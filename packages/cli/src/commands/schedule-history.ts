import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { casaName, MechaError } from "@mecha/core";
import { casaScheduleHistory } from "@mecha/service";

export function registerScheduleHistoryCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("history")
    .description("Show run history for a schedule")
    .argument("<casa>", "CASA name")
    .argument("<schedule-id>", "Schedule ID")
    .option("--limit <n>", "Maximum number of entries", "20")
    .action(async (casa: string, scheduleId: string, opts: { limit: string }) => {
      try {
        const name = casaName(casa);
        const limit = Number(opts.limit);
        const history = await casaScheduleHistory(deps.processManager, name, scheduleId, limit);

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
      /* v8 ignore start -- MechaError forwarding */
      } catch (err) {
        if (err instanceof MechaError) {
          deps.formatter.error(err.message);
          process.exitCode = err.exitCode;
        } else {
          throw err;
        }
      }
      /* v8 ignore stop */
    });
}
