import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { registerBatchCommand } from "./bot-batch-helper.js";

/** Register the 'bot stop-all' subcommand. */
export function registerBotStopAllCommand(parent: Command, deps: CommandDeps): void {
  registerBatchCommand(parent, deps, {
    name: "stop-all",
    description: "Stop all running bots",
    action: "stop",
    verb: "Stopped",
  });
}
