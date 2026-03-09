import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { registerDashboardServeCommand } from "./dashboard-serve.js";
import { registerDashboardTotpCommand } from "./dashboard-totp.js";

/** Register the 'dashboard' command group. */
export function registerDashboardCommand(program: Command, deps: CommandDeps): void {
  const dashboard = program
    .command("dashboard")
    .description("Manage the web dashboard");

  registerDashboardServeCommand(dashboard, deps);
  registerDashboardTotpCommand(dashboard, deps);
}
