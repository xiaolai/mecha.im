import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { registerTeamDeployCommand } from "./team-deploy.js";
import { registerTeamListCommand } from "./team-list.js";
import { registerTeamStatusCommand } from "./team-status.js";
import { registerTeamTeardownCommand } from "./team-teardown.js";
import { registerTeamSyncCommand } from "./team-sync.js";

/** Register the 'team' command group. */
export function registerTeamCommand(program: Command, deps: CommandDeps): void {
  const team = program
    .command("team")
    .description("Manage multi-bot teams");

  registerTeamDeployCommand(team, deps);
  registerTeamListCommand(team, deps);
  registerTeamStatusCommand(team, deps);
  registerTeamTeardownCommand(team, deps);
  registerTeamSyncCommand(team, deps);
}
