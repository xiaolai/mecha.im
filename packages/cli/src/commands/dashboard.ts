import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { registerDashboardServeCommand } from "./dashboard-serve.js";

export function registerDashboardCommand(program: Command, deps: CommandDeps): void {
  const dashboard = program
    .command("dashboard")
    .description("Manage the web dashboard");

  registerDashboardServeCommand(dashboard, deps);
}
