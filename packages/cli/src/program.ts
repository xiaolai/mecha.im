import { Command } from "commander";
import type { CommandDeps } from "./types.js";
import { registerStartCommand } from "./commands/start.js";

import pkg from "../package.json" with { type: "json" };
const CLI_VERSION: string = pkg.version;
import { registerStopDaemonCommand } from "./commands/stop-daemon.js";
import { registerRestartDaemonCommand } from "./commands/restart-daemon.js";
import { registerInitCommand } from "./commands/init.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerBotCommand } from "./commands/bot.js";
import { registerToolsCommand } from "./commands/tools.js";
import { registerAuthCommand } from "./commands/auth.js";
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
import { registerDashboardCommand } from "./commands/dashboard.js";
import { registerTotpCommand } from "./commands/totp.js";
import { registerAuthConfigCommand } from "./commands/auth-config.js";
import { registerStatusCommand } from "./commands/status.js";

/**
 * Commands that mutate state and need the CLI singleton lock.
 * Maintained here alongside command registration as single source of truth.
 * Top-level commands (e.g. "start") and "parent subcommand" pairs (e.g. "bot spawn").
 * Read-only commands NOT listed here run without the lock.
 */
export const MUTATING_COMMANDS = new Set([
  // Daemon-level mutating commands
  // NOTE: "stop" and "restart" are NOT locked — they must run while the daemon holds the lock.
  "start", "init",
  // bot spawn — must be locked to serialize port allocation across CLI processes.
  // Without the lock, concurrent spawns race to allocate the same port (R5-001).
  "bot spawn",
  // Other bot subcommands — run without lock; ProcessManager writes per-bot state files
  // (state.json, config.json) atomically. Concurrent bot ops on DIFFERENT bots are safe.
  // Concurrent ops on the SAME bot are serialized by the server's request handler.
  // agent subcommands (agent status is read-only)
  "agent start",
  // schedule subcommands — same reasoning, filesystem-level state.
  // acl subcommands — grant/revoke write to acl.json only, safe while server runs.
  // Not locked: same reasoning as meter/auth/budget — single-user manual ops.
  // node subcommands — node add/rm write to nodes.json only, safe while server runs.
  // Not locked: concurrent node add/rm has a theoretical read-modify-write race,
  // but these are manual CLI ops that a single user runs sequentially.
  // meter, auth, budget subcommands write to separate files (proxy.json, auth-profiles/,
  // budgets.json) that don't conflict with the daemon server. Running these while
  // the daemon holds the lock would deadlock the CLI.
  // Trade-off: concurrent auth/budget CLI ops on the same file have a theoretical
  // read-modify-write race, but these are manual single-user ops run sequentially.
  // TODO: Add per-resource file locks if concurrent CLI usage becomes a real scenario.
  // plugin subcommands (ls, status, test are read-only)
  "plugin add", "plugin rm",
  // audit subcommands
  "audit clear",
  // dashboard subcommands
  "dashboard serve",
  // totp subcommands — setup writes to totp-secret file only, safe while server runs.
  // auth-config — writes to auth-profiles/ only, safe while server runs.
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
    .version(CLI_VERSION)
    .option("--json", "Output JSON instead of human-readable", false)
    .option("--quiet", "Minimal output (errors only)", false)
    .option("--verbose", "Detailed output", false)
    .option("--no-color", "Disable colored output");

  // Daemon-level commands
  registerStartCommand(program, deps);
  registerStopDaemonCommand(program, deps);
  registerRestartDaemonCommand(program, deps);
  registerInitCommand(program, deps);
  registerDoctorCommand(program, deps);
  registerStatusCommand(program, deps);

  // bot management (subgroup)
  registerBotCommand(program, deps);

  // Infrastructure subgroups
  registerAgentCommand(program, deps);
  registerMeterCommand(program, deps);
  registerDashboardCommand(program, deps);
  registerNodeCommand(program, deps);

  // Feature subgroups
  registerToolsCommand(program, deps);
  registerAuthCommand(program, deps);
  registerAclCommand(program, deps);
  registerSandboxCommand(program, deps);
  registerScheduleCommand(program, deps);
  registerCostCommand(program, deps);
  registerBudgetCommand(program, deps);
  registerPluginCommand(program, deps);
  registerMcpCommand(program, deps);
  registerAuditCommand(program, deps);
  registerTotpCommand(program, deps);
  registerAuthConfigCommand(program, deps);

  return program;
}
