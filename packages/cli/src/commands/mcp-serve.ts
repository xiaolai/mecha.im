import { Option } from "commander";
import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { withErrorHandler } from "../error-handler.js";
import { main } from "@mecha/mcp-server";

function parsePort(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`Invalid port "${value}". Must be an integer between 1 and 65535`);
  }
  const n = Number(value);
  if (n < 1 || n > 65535) {
    throw new Error(`Invalid port "${value}". Must be an integer between 1 and 65535`);
  }
  return n;
}

/** Register the 'mcp serve' subcommand. */
export function registerMcpServeCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("serve")
    .description("Start the mesh MCP server (stdio or HTTP transport)")
    .addOption(
      new Option("--mode <mode>", 'Operating mode: "query" (default) or "read-only"')
        .choices(["query", "read-only"])
        .default("query"),
    )
    .addOption(
      new Option("--transport <transport>", 'Transport: "stdio" (default) or "http"')
        .choices(["stdio", "http"])
        .default("stdio"),
    )
    .option("--port <port>", "HTTP port (default: 7680)", parsePort)
    .option("--host <host>", "HTTP bind address (default: 127.0.0.1, use with caution on non-loopback)")
    .option("--token <token>", "Bearer token for HTTP authentication (required for non-loopback hosts)")
    .action(
      (opts: { mode: string; transport: "stdio" | "http"; port?: number; host?: string; token?: string }) =>
        withErrorHandler(deps, async () => {
          await main({
            mode: opts.mode,
            transport: opts.transport,
            port: opts.port,
            host: opts.host,
            token: opts.token,
            mechaDir: deps.mechaDir,
          });
        }),
    );
}
