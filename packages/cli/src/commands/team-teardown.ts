import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { listTeams, unregisterTeam } from "@mecha/teams";
import { botName as toBotName } from "@mecha/core";
import { withErrorHandler } from "../error-handler.js";

/** Register the 'team teardown' subcommand. */
export function registerTeamTeardownCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("teardown")
    .description("Stop and remove all bots in a team, then unregister it")
    .argument("<name>", "Team name")
    .option("--force", "Force kill bots instead of graceful stop", false)
    .action(async (name: string, opts: { force: boolean }) => withErrorHandler(deps, async () => {
      const teams = listTeams(deps.mechaDir);
      const team = teams.find((t) => t.name === name);

      if (!team) {
        deps.formatter.error(`Team "${name}" not found`);
        process.exitCode = 1;
        return;
      }

      // Stop and remove each bot in the team
      for (const bot of team.bots) {
        const validated = toBotName(bot);
        const info = deps.processManager.get(validated);
        if (info?.state === "running") {
          if (opts.force) {
            await deps.processManager.kill(validated);
          } else {
            await deps.processManager.stop(validated);
          }
        }
        deps.formatter.info(`Stopped bot: ${bot}`);
      }

      // Unregister the team
      const removed = unregisterTeam(deps.mechaDir, name);
      if (removed) {
        deps.formatter.success(`Team "${name}" torn down (${team.bots.length} bot(s) stopped)`);
      /* v8 ignore start -- defensive: team was found above, unregister should succeed */
      } else {
        deps.formatter.error(`Failed to unregister team "${name}"`);
        process.exitCode = 1;
      }
      /* v8 ignore stop */
    }));
}
