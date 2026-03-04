import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { registerBatchCommand } from "./bot-batch-helper.js";

export function registerBotRestartAllCommand(parent: Command, deps: CommandDeps): void {
  registerBatchCommand(parent, deps, {
    name: "restart-all",
    description: "Restart all bots (stop + re-spawn from config)",
    action: "restart",
    verb: "Restarted",
  });
}
