import { existsSync } from "node:fs";
import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { readNodes } from "@mecha/core";
import { listTeams } from "@mecha/teams";
import { createSyncBundle } from "@mecha/connect";

import { withErrorHandler } from "../error-handler.js";

/** Register the 'team sync' subcommand. */
export function registerTeamSyncCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("sync")
    .description("Sync team workspace to registered nodes")
    .argument("<name>", "Team name to sync")
    .option("--node <name>", "Sync to a specific node only")
    .action(async (name: string, opts: { node?: string }) => withErrorHandler(deps, async () => {
      const teams = listTeams(deps.mechaDir);
      const team = teams.find((t) => t.name === name);

      if (!team) {
        deps.formatter.error(`Team "${name}" not found`);
        process.exitCode = 1;
        return;
      }

      if (!team.workspace) {
        deps.formatter.error(`Team "${name}" has no workspace configured`);
        process.exitCode = 1;
        return;
      }

      if (!existsSync(team.workspace)) {
        deps.formatter.error(`Workspace "${team.workspace}" does not exist`);
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

      const bundle = createSyncBundle(team.workspace);
      const filesCount = Object.keys(bundle.files).length;

      /* v8 ignore start -- empty workspace branch */
      if (filesCount === 0) {
        deps.formatter.info("Workspace is empty, nothing to sync");
        return;
      }
      /* v8 ignore stop */

      deps.formatter.error(
        "Server-side sync endpoint not yet implemented. Use manual sync: " +
        `scp -r ${team.workspace} <node>:${team.workspace}`,
      );
      process.exitCode = 1;
    }));
}
