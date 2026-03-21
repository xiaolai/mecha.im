import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { join } from "node:path";
import { createAlertEngine } from "@mecha/observe";
import { withErrorHandler } from "../error-handler.js";

/** Register the 'alert list' subcommand. */
export function registerAlertListCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("list")
    .alias("ls")
    .description("Show fired alerts")
    .option("--rules", "show alert rules instead of fired alerts")
    .action((opts: { rules?: boolean }) =>
      withErrorHandler(deps, async () => {
        const engine = createAlertEngine(join(deps.mechaDir, "observe", "alerts"));

        if (opts.rules) {
          const rules = engine.rules();
          if (rules.length === 0) {
            deps.formatter.info("No alert rules configured");
            return;
          }

          if (deps.formatter.isJson) {
            deps.formatter.json(rules);
            return;
          }

          deps.formatter.table(
            ["ID", "Metric", "Comparison", "Threshold", "Message"],
            rules.map((r) => [
              r.id,
              r.metric,
              r.comparison,
              String(r.threshold),
              r.message,
            ]),
          );
          return;
        }

        const alerts = engine.fired();
        if (alerts.length === 0) {
          deps.formatter.info("No fired alerts");
          return;
        }

        if (deps.formatter.isJson) {
          deps.formatter.json(alerts);
          return;
        }

        deps.formatter.table(
          ["Rule", "Value", "Message", "Fired At"],
          alerts.map((a) => [
            a.ruleId,
            String(a.value),
            a.message,
            a.firedAt,
          ]),
        );
      }),
    );
}
