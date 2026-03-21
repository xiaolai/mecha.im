import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { join } from "node:path";
import { createAlertEngine } from "@mecha/observe";
import { withErrorHandler } from "../error-handler.js";

/** Register the 'alert remove' subcommand. */
export function registerAlertRemoveCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("remove")
    .alias("rm")
    .description("Remove an alert rule")
    .argument("<id>", "rule ID to remove")
    .action((id: string) =>
      withErrorHandler(deps, async () => {
        const engine = createAlertEngine(join(deps.mechaDir, "observe", "alerts"));
        const removed = engine.removeRule(id);

        if (!removed) {
          deps.formatter.info(`No alert rule found with ID "${id}"`);
          return;
        }

        deps.formatter.success(`Alert rule "${id}" removed`);
      }),
    );
}
