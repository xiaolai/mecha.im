import { Command } from "commander";
import type { CommandDeps } from "./types.js";
import { registerInitCommand } from "./commands/init.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerSpawnCommand } from "./commands/spawn.js";
import { registerKillCommand } from "./commands/kill.js";
import { registerStopCommand } from "./commands/stop.js";
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
import { registerSandboxCommand } from "./commands/sandbox.js";
import { registerScheduleCommand } from "./commands/schedule.js";
import { registerMeterCommand } from "./commands/meter.js";
import { registerCostCommand } from "./commands/cost.js";
import { registerBudgetCommand } from "./commands/budget.js";
import { registerPluginCommand } from "./commands/plugin.js";
import { registerMcpCommand } from "./commands/mcp.js";
import { registerAuditCommand } from "./commands/audit.js";

/**
 * Commands that mutate state and need the CLI singleton lock.
 * Maintained here alongside command registration as single source of truth.
 * Top-level commands (e.g. "spawn") and "parent subcommand" pairs (e.g. "meter start").
 * Read-only commands NOT listed here run without the lock.
 */
export const MUTATING_COMMANDS = new Set([
  // Top-level mutating commands
  "spawn", "stop", "kill", "init", "configure",
  // agent subcommands (agent status is read-only)
  "agent start",
  // meter subcommands
  "meter start", "meter stop",
  // schedule subcommands
  "schedule add", "schedule remove", "schedule pause", "schedule resume", "schedule run",
  // acl subcommands
  "acl grant", "acl revoke",
  // node subcommands
  "node add", "node rm",
  // auth subcommands (auth ls, auth test are read-only)
  "auth add", "auth rm", "auth default", "auth tag", "auth switch", "auth renew",
  // budget subcommands
  "budget set", "budget rm",
  // plugin subcommands (ls, status, test are read-only)
  "plugin add", "plugin rm",
  // audit subcommands
  "audit clear",
]);

/**
 * Check if the current argv requires the singleton lock.
 * Returns true for mutating commands, false for read-only ones.
 */
export function needsLock(argv: string[]): boolean {
  const args = argv.slice(2).filter((a) => !a.startsWith("-"));
  if (args.length === 0) return false; // --help, --version

  const cmd = args[0]!;
  if (MUTATING_COMMANDS.has(cmd)) return true;

  if (args.length >= 2) {
    if (MUTATING_COMMANDS.has(`${cmd} ${args[1]}`)) return true;
  }

  return false;
}

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
  registerStopCommand(program, deps);
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
  registerSandboxCommand(program, deps);
  registerScheduleCommand(program, deps);
  registerMeterCommand(program, deps);
  registerCostCommand(program, deps);
  registerBudgetCommand(program, deps);
  registerPluginCommand(program, deps);
  registerMcpCommand(program, deps);
  registerAuditCommand(program, deps);

  return program;
}
