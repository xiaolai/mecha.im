import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { withErrorHandler } from "../error-handler.js";

/** Register the 'workflow list' subcommand. */
export function registerWorkflowListCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("list")
    .alias("ls")
    .description("List all workflow definitions")
    .action(() =>
      withErrorHandler(deps, async () => {
        const workflowsDir = join(deps.mechaDir, "workflows");

        if (!existsSync(workflowsDir)) {
          deps.formatter.info("No workflows directory found");
          return;
        }

        const files = readdirSync(workflowsDir).filter((f) => f.endsWith(".yaml"));

        if (files.length === 0) {
          deps.formatter.info("No workflows found");
          return;
        }

        deps.formatter.table(
          ["Name", "File"],
          files.map((f) => [f.replace(/\.yaml$/, ""), f]),
        );
      }),
    );
}
