import { Command } from "commander";
import type { CommandDeps } from "./types.js";
import { registerInitCommand } from "./commands/init.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerSpawnCommand } from "./commands/spawn.js";
import { registerKillCommand } from "./commands/kill.js";
import { registerLsCommand } from "./commands/ls.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerLogsCommand } from "./commands/logs.js";
import { registerChatCommand } from "./commands/chat.js";
import { registerSessionsCommand } from "./commands/sessions.js";
import { registerToolsCommand } from "./commands/tools.js";
import { registerAuthCommand } from "./commands/auth.js";
import { registerFindCommand } from "./commands/find.js";
import { registerConfigureCommand } from "./commands/configure.js";
import { registerAclCommand } from "./commands/acl.js";
import { registerNodeCommand } from "./commands/node.js";
import { registerAgentCommand } from "./commands/agent.js";

/** Create the root mecha CLI program with global flags */
export function createProgram(deps: CommandDeps): Command {
  const program = new Command();

  program
    .name("mecha")
    .description("Local-first multi-agent runtime")
    .version("0.2.0")
    .option("--json", "Output JSON instead of human-readable", false)
    .option("--quiet", "Minimal output (errors only)", false)
    .option("--verbose", "Detailed output", false)
    .option("--no-color", "Disable colored output");

  registerInitCommand(program, deps);
  registerDoctorCommand(program, deps);
  registerSpawnCommand(program, deps);
  registerKillCommand(program, deps);
  registerLsCommand(program, deps);
  registerStatusCommand(program, deps);
  registerLogsCommand(program, deps);
  registerChatCommand(program, deps);
  registerSessionsCommand(program, deps);
  registerToolsCommand(program, deps);
  registerAuthCommand(program, deps);
  registerFindCommand(program, deps);
  registerConfigureCommand(program, deps);
  registerAclCommand(program, deps);
  registerNodeCommand(program, deps);
  registerAgentCommand(program, deps);

  return program;
}
