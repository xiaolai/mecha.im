import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { registerNodeInitCommand } from "./node-init.js";
import { registerNodeAddCommand } from "./node-add.js";
import { registerNodeRmCommand } from "./node-rm.js";
import { registerNodeLsCommand } from "./node-ls.js";
import { registerNodeInviteCommand } from "./node-invite.js";
import { registerNodeJoinCommand } from "./node-join.js";
import { registerNodePingCommand } from "./node-ping.js";
import { registerNodeHealthCommand } from "./node-health.js";
import { registerNodeInfoCommand } from "./node-info.js";
import { registerNodePromoteCommand } from "./node-promote.js";

export function registerNodeCommand(program: Command, deps: CommandDeps): void {
  const node = program
    .command("node")
    .description("Manage mesh nodes");

  registerNodeInitCommand(node, deps);
  registerNodeAddCommand(node, deps);
  registerNodeRmCommand(node, deps);
  registerNodeLsCommand(node, deps);
  registerNodeInviteCommand(node, deps);
  registerNodeJoinCommand(node, deps);
  registerNodePingCommand(node, deps);
  registerNodeHealthCommand(node, deps);
  registerNodeInfoCommand(node, deps);
  registerNodePromoteCommand(node, deps);
}
