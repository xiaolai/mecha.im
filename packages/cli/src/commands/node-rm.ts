import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { removeNode, NodeNotFoundError } from "@mecha/core";
import { withErrorHandler } from "../error-handler.js";

export function registerNodeRmCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("rm")
    .description("Remove a peer node")
    .argument("<name>", "Peer node name")
    .action(async (name: string) => withErrorHandler(deps, async () => {
      const removed = removeNode(deps.mechaDir, name);
      if (!removed) throw new NodeNotFoundError(name);
      deps.formatter.success(`Node removed: ${name}`);
    }));
}
