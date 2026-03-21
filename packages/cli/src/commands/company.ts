import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { registerCompanyInitCommand } from "./company-init.js";
import { registerCompanySyncCommand } from "./company-sync.js";

/** Register the 'company' command group. */
export function registerCompanyCommand(program: Command, deps: CommandDeps): void {
  const company = program
    .command("company")
    .description("Manage company-wide configuration");

  registerCompanyInitCommand(company, deps);
  registerCompanySyncCommand(company, deps);
}
