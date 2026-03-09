import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { listPlugins } from "@mecha/core";

/** Register the 'plugin ls' subcommand. */
export function registerPluginLsCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("ls")
    .description("List all registered plugins")
    .action(() => {
      const plugins = listPlugins(deps.mechaDir);
      if (plugins.length === 0) {
        deps.formatter.info("No plugins registered");
        return;
      }
      deps.formatter.table(
        ["Name", "Type", "URL/Command", "Description"],
        plugins.map(({ name, config }) => [
          name,
          config.type,
          config.type === "stdio"
            ? [config.command, ...(config.args ?? [])].join(" ")
            : config.url,
          config.description ?? "",
        ]),
      );
    });
}
