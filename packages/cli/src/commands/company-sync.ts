import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { readNodes } from "@mecha/core";
import { createSyncBundle } from "@mecha/connect";

import { withErrorHandler } from "../error-handler.js";

const COMPANY_DIR = "_company";

/** Register the 'company sync' subcommand. */
export function registerCompanySyncCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("sync")
    .description("Sync company config to registered nodes")
    .option("--node <name>", "Sync to a specific node only")
    .action(async (opts: { node?: string }) => withErrorHandler(deps, async () => {
      const companyDir = join(deps.mechaDir, COMPANY_DIR);

      if (!existsSync(companyDir)) {
        deps.formatter.error("Company repository not initialized. Run 'mecha company init' first.");
        process.exitCode = 1;
        return;
      }

      const allNodes = readNodes(deps.mechaDir);
      /* v8 ignore start -- node filter branch */
      const nodes = opts.node
        ? allNodes.filter((n) => n.name === opts.node)
        : allNodes;
      /* v8 ignore stop */

      if (nodes.length === 0) {
        if (opts.node) {
          deps.formatter.error(`Node "${opts.node}" not found`);
        } else {
          deps.formatter.error("No registered nodes. Add a node with 'mecha node add' first.");
        }
        process.exitCode = 1;
        return;
      }

      const bundle = createSyncBundle(companyDir);
      const filesCount = Object.keys(bundle.files).length;

      /* v8 ignore start -- empty directory branch */
      if (filesCount === 0) {
        deps.formatter.info("Company directory is empty, nothing to sync");
        return;
      }
      /* v8 ignore stop */

      deps.formatter.error(
        "Server-side sync endpoint not yet implemented. Use manual sync: " +
        "scp -r ~/.mecha/_company/ <node>:~/.mecha/_company/",
      );
      process.exitCode = 1;
    }));
}
