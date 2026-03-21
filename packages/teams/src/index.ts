export { validateTeamDef, parseTeamDef } from "./definition.js";
export { deployTeam, listTeams, unregisterTeam } from "./deploy.js";
export type { DeployOpts } from "./deploy.js";
export type {
  TeamDef,
  TeamBotDef,
  TeamAclDef,
  ScaffoldDef,
  DeployResult,
  DeployedTeam,
} from "./types.js";
