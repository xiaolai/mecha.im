export { validateTeamDef, parseTeamDef } from "./definition.js";
export { deployTeam, listTeams, unregisterTeam, teardownTeam } from "./deploy.js";
export type { DeployOpts, TeardownOpts, TeardownResult } from "./deploy.js";
export type {
  TeamDef,
  TeamBotDef,
  TeamAclDef,
  ScaffoldDef,
  DeployResult,
  DeployedTeam,
} from "./types.js";
