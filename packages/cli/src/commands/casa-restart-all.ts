import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { registerBatchCommand } from "./casa-batch-helper.js";

export function registerCasaRestartAllCommand(parent: Command, deps: CommandDeps): void {
  registerBatchCommand(parent, deps, {
    name: "restart-all",
    description: "Restart all CASAs (stop + re-spawn from config)",
    action: "restart",
    verb: "Restarted",
  });
}
