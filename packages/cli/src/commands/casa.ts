import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { registerCasaSpawnCommand } from "./casa-spawn.js";
import { registerCasaStartCommand } from "./casa-start.js";
import { registerCasaStopCommand } from "./casa-stop.js";
import { registerCasaKillCommand } from "./casa-kill.js";
import { registerCasaRestartCommand } from "./casa-restart.js";
import { registerCasaRemoveCommand } from "./casa-remove.js";
import { registerCasaLsCommand } from "./casa-ls.js";
import { registerCasaStatusCommand } from "./casa-status.js";
import { registerCasaLogsCommand } from "./casa-logs.js";
import { registerCasaConfigureCommand } from "./casa-configure.js";
import { registerCasaFindCommand } from "./casa-find.js";
import { registerCasaChatCommand } from "./casa-chat.js";
import { registerCasaSessionsCommand } from "./casa-sessions.js";

export function registerCasaCommand(program: Command, deps: CommandDeps): void {
  const casa = program
    .command("casa")
    .description("Manage CASA processes");

  registerCasaSpawnCommand(casa, deps);
  registerCasaStartCommand(casa, deps);
  registerCasaStopCommand(casa, deps);
  registerCasaKillCommand(casa, deps);
  registerCasaRestartCommand(casa, deps);
  registerCasaRemoveCommand(casa, deps);
  registerCasaLsCommand(casa, deps);
  registerCasaStatusCommand(casa, deps);
  registerCasaLogsCommand(casa, deps);
  registerCasaConfigureCommand(casa, deps);
  registerCasaFindCommand(casa, deps);
  registerCasaChatCommand(casa, deps);
  registerCasaSessionsCommand(casa, deps);
}
