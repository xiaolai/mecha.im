import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { listTeams } from "@mecha/teams";
import { withErrorHandler } from "../error-handler.js";

/** Register the 'team list' subcommand. */
export function registerTeamListCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("list")
    .description("List deployed teams")
    .action(async () => withErrorHandler(deps, async () => {
      const teams = listTeams(deps.mechaDir);

      if (teams.length === 0) {
        deps.formatter.info("No teams deployed");
        return;
      }

      /* v8 ignore start -- JSON output path */
      if (deps.formatter.isJson) {
        deps.formatter.json(teams);
        return;
      }
      /* v8 ignore stop */

      deps.formatter.table(
        ["Name", "Bots", "Home", "Workspace", "Deployed At"],
        teams.map((t) => [
          t.name,
          t.bots.join(", "),
          t.home ?? "-",
          t.workspace ?? "-",
          t.deployedAt,
        ]),
      );
    }));
}
