import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { registerPluginAddCommand } from "./plugin-add.js";
import { registerPluginRmCommand } from "./plugin-rm.js";
import { registerPluginLsCommand } from "./plugin-ls.js";
import { registerPluginStatusCommand } from "./plugin-status.js";
import { registerPluginTestCommand } from "./plugin-test.js";

/** Register the 'plugin' command group. */
export function registerPluginCommand(program: Command, deps: CommandDeps): void {
  const plugin = program
    .command("plugin")
    .description("Manage MCP server plugins");

  registerPluginAddCommand(plugin, deps);
  registerPluginRmCommand(plugin, deps);
  registerPluginLsCommand(plugin, deps);
  registerPluginStatusCommand(plugin, deps);
  registerPluginTestCommand(plugin, deps);
}
