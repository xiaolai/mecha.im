import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { botName } from "@mecha/core";
import { botScheduleRun } from "@mecha/service";
import { withErrorHandler } from "../error-handler.js";

/** Register the 'schedule run' subcommand. */
export function registerScheduleRunCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("run")
    .description("Trigger a schedule immediately")
    .argument("<bot>", "bot name")
    .argument("<schedule-id>", "Schedule ID to trigger")
    .action((bot: string, scheduleId: string) =>
      withErrorHandler(deps, async () => {
        const name = botName(bot);
        const result = await botScheduleRun(deps.processManager, name, scheduleId);
        if (result.outcome === "success") {
          deps.formatter.success(`Run completed (${result.durationMs}ms)`);
        } else if (result.outcome === "skipped") {
          deps.formatter.warn(`Run skipped: ${result.error}`);
        } else {
          deps.formatter.error(`Run failed: ${result.error}`);
          process.exitCode = 1;
        }
      }),
    );
}
