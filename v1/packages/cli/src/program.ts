import { createRequire } from "node:module";
import { Command } from "commander";
import { createProcessManager } from "@mecha/process";
import { createFormatter } from "./output/formatter.js";
import type { CommandDeps } from "./types.js";
import type { GlobalOptions } from "@mecha/core";

import { registerDoctorCommand } from "./commands/doctor.js";
import { registerInitCommand } from "./commands/init.js";
import { registerUpCommand } from "./commands/up.js";
import { registerLsCommand } from "./commands/ls.js";
import { registerStartCommand, registerStopCommand, registerRestartCommand } from "./commands/lifecycle.js";
import { registerRmCommand } from "./commands/rm.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerLogsCommand } from "./commands/logs.js";
import { registerUiCommand } from "./commands/ui.js";
import { registerMcpCommand } from "./commands/mcp.js";
import { registerConfigureCommand } from "./commands/configure.js";
import { registerDashboardCommand } from "./commands/dashboard.js";
import { registerTokenCommand } from "./commands/token.js";
import { registerEnvCommand } from "./commands/env.js";
import { registerPruneCommand } from "./commands/prune.js";
import { registerChatCommand } from "./commands/chat.js";
import { registerSessionsCommand } from "./commands/sessions.js";
import { registerCompletionsCommand } from "./commands/completions.js";
import { registerChannelCommand } from "./commands/channel.js";
import { registerAgentCommand } from "./commands/agent.js";
import { registerNodeCommand } from "./commands/node.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

export function createProgram(depsOverride?: CommandDeps): Command {
  const program = new Command();

  program
    .name("mecha")
    .description("Local-first multi-agent runtime CLI")
    .version(version)
    .option("--json", "Output results as JSON")
    .option("-q, --quiet", "Suppress non-essential output")
    .option("-v, --verbose", "Enable verbose output")
    .option("--no-color", "Disable colored output");

  // Build deps lazily so tests can inject their own
  const deps: CommandDeps = depsOverride ?? {
    get processManager() {
      return createProcessManager();
    },
    get formatter() {
      const opts = program.opts() as GlobalOptions;
      return createFormatter(opts);
    },
  };

  // Register all subcommands
  // Note: Input validation (port, path, permission-mode, env) is handled
  // by @mecha/service functions using @mecha/contracts schemas.
  // CLI commands are thin wrappers that delegate to the service layer.
  registerDoctorCommand(program, deps);
  registerInitCommand(program, deps);
  registerUpCommand(program, deps);
  registerLsCommand(program, deps);
  registerStopCommand(program, deps);
  registerStartCommand(program, deps);
  registerRestartCommand(program, deps);
  registerRmCommand(program, deps);
  registerStatusCommand(program, deps);
  registerLogsCommand(program, deps);
  registerUiCommand(program, deps);
  registerMcpCommand(program, deps);
  registerConfigureCommand(program, deps);
  registerDashboardCommand(program, deps);
  registerTokenCommand(program, deps);
  registerEnvCommand(program, deps);
  registerPruneCommand(program, deps);
  registerChatCommand(program, deps);
  registerSessionsCommand(program, deps);
  registerCompletionsCommand(program, deps);
  registerChannelCommand(program, deps);
  registerAgentCommand(program, deps);
  registerNodeCommand(program, deps);

  return program;
}
