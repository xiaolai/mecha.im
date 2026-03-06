import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { mechaToolInstall, mechaToolLs, resolveClaudeRuntime } from "@mecha/service";
import { withErrorHandler } from "../error-handler.js";

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
    .action(async (name: string, opts: { version?: string; description?: string }) => withErrorHandler(deps, async () => {
      const info = mechaToolInstall(deps.mechaDir, {
        name,
        version: opts.version,
        description: opts.description,
      });
      deps.formatter.success(`Installed ${info.name}@${info.version}`);
    }));

  tools
    .command("ls")
    .description("List installed tools")
    .action(async () => withErrorHandler(deps, async () => {
      const list = mechaToolLs(deps.mechaDir);
      if (list.length === 0) {
        deps.formatter.info("No tools installed");
        return;
      }
      deps.formatter.table(
        ["Name", "Version", "Description"],
        list.map((t) => [t.name, t.version, t.description]),
      );
    }));

  tools
    .command("runtime")
    .description("Show Claude Code runtime binary info")
    .action(async () => withErrorHandler(deps, async () => {
      const info = await resolveClaudeRuntime();
      if (!info.binPath) {
        deps.formatter.error("Claude Code binary not found");
        deps.formatter.info("Install: npm install -g @anthropic-ai/claude-code");
        return;
      }
      deps.formatter.table(
        ["Property", "Value"],
        [
          ["Binary", info.binPath],
          ["Version", info.version ?? "unknown"],
          ["Resolved from", info.resolvedFrom],
        ],
      );
    }));
}
