import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { registerBatchCommand } from "./casa-batch-helper.js";

export function registerCasaStopAllCommand(parent: Command, deps: CommandDeps): void {
  registerBatchCommand(parent, deps, {
    name: "stop-all",
    description: "Stop all running CASAs",
    action: "stop",
    verb: "Stopped",
  });
}
