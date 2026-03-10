import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { withErrorHandler } from "../error-handler.js";
import { realpathSync } from "node:fs";

/** Resolve the real path to the mecha binary, handling Bun's virtual /$bunfs/ paths. */
function resolveMechaPath(): string {
  /* v8 ignore start -- process.argv[1] is always defined at runtime */
  const raw = process.argv[1] ?? "mecha";
  /* v8 ignore stop */
  // Bun emits /$bunfs/root/... for compiled binaries — resolve to real path
  if (raw.startsWith("/$bunfs/") || raw.startsWith("/$bunfs\\")) {
    try { return realpathSync(process.execPath); } catch { return process.execPath; }
  }
  return raw;
}

/** Register the 'mcp config' subcommand. */
export function registerMcpConfigCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("config")
    .description("Output Claude Desktop configuration JSON")
    .action(() =>
      withErrorHandler(deps, async () => {
        const config = {
          mcpServers: {
            mecha: {
              command: resolveMechaPath(),
              args: ["mcp", "serve"],
            },
          },
        };
        deps.formatter.json(config);
      }),
    );
}
