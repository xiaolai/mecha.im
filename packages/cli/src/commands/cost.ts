import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { meterDir } from "@mecha/meter";
import { queryCostToday, queryCostForCasa } from "@mecha/meter";
import { withErrorHandler } from "../error-handler.js";

export function registerCostCommand(program: Command, deps: CommandDeps): void {
  program
    .command("cost")
    .description("Show API cost summary")
    .argument("[casa]", "CASA name (omit for all)")
    .action((casa?: string) =>
      withErrorHandler(deps, async () => {
        const dir = meterDir(deps.mechaDir);
        const result = casa
          ? queryCostForCasa(dir, casa)
          : queryCostToday(dir);

        if (deps.formatter.isJson) {
          deps.formatter.json(result);
          return;
        }

        if (result.total.requests === 0) {
          deps.formatter.info(`No API activity — ${result.period}`);
          return;
        }

        deps.formatter.info(`Total (${result.period})          $${result.total.costUsd.toFixed(2)}  (UTC)`);

        const casas = Object.entries(result.byCasa);
        if (casas.length > 0 && !casa) {
          deps.formatter.info("─".repeat(35));
          for (const [name, summary] of casas.sort((a, b) => b[1].costUsd - a[1].costUsd)) {
            deps.formatter.info(`${name.padEnd(23)} $${summary.costUsd.toFixed(2)}`);
          }
        }
      }),
    );
}
