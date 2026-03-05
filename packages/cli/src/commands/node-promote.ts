import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { promoteDiscoveredNode } from "@mecha/core";
import { withErrorHandler } from "../error-handler.js";

export function registerNodePromoteCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("promote")
    .description("Promote a discovered node to manual registry")
    .argument("<name>", "Discovered node name")
    .action(async (name: string) => withErrorHandler(deps, async () => {
      const entry = promoteDiscoveredNode(deps.mechaDir, name);
      if (!entry) {
        deps.formatter.error(`Discovered node not found: ${name}`);
        process.exitCode = 1;
        return;
      }
      deps.formatter.success(`Promoted ${name} (${entry.host}:${entry.port}) to manual registry`);
    }));
}
