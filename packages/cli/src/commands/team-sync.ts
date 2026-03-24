import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { readNodes } from "@mecha/core";
import { listTeams } from "@mecha/teams";

import { withErrorHandler } from "../error-handler.js";

const execFileAsync = promisify(execFile);

/** Register the 'team sync' subcommand. */
export function registerTeamSyncCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("sync")
    .description("Sync team workspace to registered nodes via rsync")
    .argument("<name>", "Team name to sync")
    .option("--node <name>", "Sync to a specific node only")
    .option("--dry-run", "Preview sync without making changes", false)
    .action(async (name: string, opts: { node?: string; dryRun: boolean }) => withErrorHandler(deps, async () => {
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

      let synced = 0;
      for (const node of nodes) {
        const args = ["-az", "--delete"];
        if (opts.dryRun) args.push("--dry-run");
        args.push(`${team.workspace}/`, `${node.host}:${team.workspace}/`);

        try {
          const { stdout } = await execFileAsync("rsync", args);
          synced++;
          /* v8 ignore start -- dry-run output branch */
          if (opts.dryRun && stdout.trim()) {
            deps.formatter.info(`[dry-run] ${node.name}: ${stdout.trim()}`);
          }
          /* v8 ignore stop */
          deps.formatter.info(`Synced to ${node.name} (${node.host})`);
        /* v8 ignore start -- rsync failure in real env */
        } catch (err) {
          deps.formatter.error(`Failed to sync to ${node.name}: ${(err as Error).message}`);
          process.exitCode = 1;
        }
        /* v8 ignore stop */
      }

      if (synced > 0) {
        deps.formatter.success(`Synced workspace to ${synced} node(s)`);
      }
    }));
}
