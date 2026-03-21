import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { listTeams } from "@mecha/teams";
import { withErrorHandler } from "../error-handler.js";

/** Register the 'team status' subcommand. */
export function registerTeamStatusCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("status")
    .description("Show status of a deployed team")
    .argument("<name>", "Team name")
    .action(async (name: string) => withErrorHandler(deps, async () => {
      const teams = listTeams(deps.mechaDir);
      const team = teams.find((t) => t.name === name);

      if (!team) {
        deps.formatter.error(`Team "${name}" not found`);
        process.exitCode = 1;
        return;
      }

      /* v8 ignore start -- JSON output path */
      if (deps.formatter.isJson) {
        deps.formatter.json(team);
        return;
      }
      /* v8 ignore stop */

      deps.formatter.table(
        ["Field", "Value"],
        [
          ["name", team.name],
          ["bots", team.bots.join(", ")],
          ["home", team.home ?? "-"],
          ["workspace", team.workspace ?? "-"],
          ["deployedAt", team.deployedAt],
        ],
      );
    }));
}
