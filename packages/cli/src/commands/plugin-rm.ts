import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { removePlugin, PluginNotFoundError } from "@mecha/core";
import { withErrorHandler } from "../error-handler.js";

export function registerPluginRmCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("rm")
    .description("Remove a plugin from the registry")
    .argument("<name>", "Plugin name")
    .action(async (name: string) => withErrorHandler(deps, async () => {
      const removed = removePlugin(deps.mechaDir, name);
      if (!removed) throw new PluginNotFoundError(name);
      deps.formatter.success(`Plugin removed: ${name}`);
    }));
}
