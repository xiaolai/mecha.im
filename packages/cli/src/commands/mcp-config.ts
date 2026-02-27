import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { withErrorHandler } from "../error-handler.js";

export function registerMcpConfigCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("config")
    .description("Output Claude Desktop configuration JSON")
    .action(() =>
      withErrorHandler(deps, async () => {
        /* v8 ignore start -- process.argv[1] is always defined at runtime */
        const mechaPath = process.argv[1] ?? "mecha";
        /* v8 ignore stop */
        const config = {
          mcpServers: {
            mecha: {
              command: mechaPath,
              args: ["mcp", "serve"],
            },
          },
        };
        deps.formatter.json(config);
      }),
    );
}
