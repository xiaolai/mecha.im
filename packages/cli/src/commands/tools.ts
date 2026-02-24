import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { mechaToolInstall, mechaToolLs } from "@mecha/service";

export function registerToolsCommand(program: Command, deps: CommandDeps): void {
  const tools = program
    .command("tools")
    .description("Manage mecha tools");

  tools
    .command("install")
    .description("Install a tool")
    .argument("<name>", "Tool name")
    .option("-v, --version <version>", "Tool version")
    .option("-d, --description <desc>", "Tool description")
    .action(async (name: string, opts: { version?: string; description?: string }) => {
      const info = mechaToolInstall(deps.mechaDir, {
        name,
        version: opts.version,
        description: opts.description,
      });
      deps.formatter.success(`Installed ${info.name}@${info.version}`);
    });

  tools
    .command("ls")
    .description("List installed tools")
    .action(async () => {
      const list = mechaToolLs(deps.mechaDir);
      if (list.length === 0) {
        deps.formatter.info("No tools installed");
        return;
      }
      deps.formatter.table(
        ["Name", "Version", "Description"],
        list.map((t) => [t.name, t.version, t.description]),
      );
    });
}
