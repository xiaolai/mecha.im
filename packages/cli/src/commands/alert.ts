import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { registerAlertListCommand } from "./alert-list.js";
import { registerAlertAddCommand } from "./alert-add.js";
import { registerAlertRemoveCommand } from "./alert-remove.js";

/** Register the 'alert' command group. */
export function registerAlertCommand(program: Command, deps: CommandDeps): void {
  const alert = program
    .command("alert")
    .description("Manage alert rules and view fired alerts");

  registerAlertListCommand(alert, deps);
  registerAlertAddCommand(alert, deps);
  registerAlertRemoveCommand(alert, deps);
}
