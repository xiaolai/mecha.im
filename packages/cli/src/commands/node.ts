import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { registerNodeInitCommand } from "./node-init.js";
import { registerNodeAddCommand } from "./node-add.js";
import { registerNodeRmCommand } from "./node-rm.js";
import { registerNodeLsCommand } from "./node-ls.js";

export function registerNodeCommand(program: Command, deps: CommandDeps): void {
  const node = program
    .command("node")
    .description("Manage mesh nodes");

  registerNodeInitCommand(node, deps);
  registerNodeAddCommand(node, deps);
  registerNodeRmCommand(node, deps);
  registerNodeLsCommand(node, deps);
}
