import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { resolveMcpEndpoint } from "@mecha/service";
import { toUserMessage, toExitCode } from "@mecha/contracts";

const DEFAULT_MCP_HTTP_PORT = 7670;

function maskToken(token: string, showFull: boolean): string {
  if (showFull) return token;
  if (token.length <= 8) return "****";
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

export function registerMcpCommand(parent: Command, deps: CommandDeps): void {
  const mcp = parent
    .command("mcp")
    .description("MCP server management and endpoint info");

  // --- mcp serve — start the mesh MCP server ---
  mcp
    .command("serve")
    .description("Start the mesh MCP server (stdio or HTTP)")
    .option("--http", "Use HTTP transport instead of stdio")
    .option("--port <port>", `HTTP port (default: ${DEFAULT_MCP_HTTP_PORT})`, String(DEFAULT_MCP_HTTP_PORT))
    .action(async (opts: { http?: boolean; port: string }) => {
      try {
        const port = Number(opts.port);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          deps.formatter.error(`Invalid port: ${opts.port} (must be 1–65535)`);
          process.exitCode = 1;
          return;
        }
        const { createMeshMcpServer, runStdio, runHttp } = await import("@mecha/mcp-server");
        const { readNodes } = await import("@mecha/agent");
        const handle = createMeshMcpServer({
          pm: deps.processManager,
          getNodes: () => readNodes(),
        });
        if (opts.http) {
          await runHttp(handle, { port });
        } else {
          await runStdio(handle);
        }
      } catch (err) {
        deps.formatter.error(toUserMessage(err));
        process.exitCode = toExitCode(err);
      }
    });

  // --- mcp config — output mesh MCP config ---
  mcp
    .command("config")
    .description("Output ready-to-paste mesh MCP config for Claude Desktop / Claude Code")
    .action(async () => {
      deps.formatter.json({
        mcpServers: {
          "mecha-mesh": {
            type: "stdio",
            command: "mecha",
            args: ["mcp", "serve"],
          },
        },
      });
    });

  // --- mcp info <id> — per-container MCP endpoint info ---
  // Also the default action when `mcp <id>` is used directly.
  mcp
    .command("info <id>", { isDefault: true })
    .description("Print MCP endpoint URL and token for a Mecha")
    .option("--show-token", "Show full auth token (masked by default)")
    .option("--config", "Output ready-to-paste MCP client config JSON")
    .action(async (id: string, opts: { showToken?: boolean; config?: boolean }) => {
      await showEndpoint(id, opts, deps, parent.opts().json ?? false);
    });
}

function buildConfig(
  id: string,
  endpoint: string,
  token: string | undefined,
): Record<string, unknown> {
  const serverEntry: Record<string, unknown> = { url: endpoint };
  if (token) {
    serverEntry.headers = { Authorization: `Bearer ${token}` };
  }
  return { mcpServers: { [`mecha-${id}`]: serverEntry } };
}

function renderEndpoint(
  result: { endpoint: string; token?: string },
  opts: { showToken?: boolean },
  formatter: CommandDeps["formatter"],
  jsonMode: boolean,
): void {
  if (jsonMode) {
    const output = { ...result };
    if (output.token) {
      output.token = maskToken(output.token, opts.showToken ?? false);
    }
    formatter.json(output);
  } else {
    formatter.info(`Endpoint: ${result.endpoint}`);
    if (result.token) {
      const display = opts.showToken
        ? result.token
        : `${maskToken(result.token, false)}  (use --show-token for full value)`;
      formatter.info(`Token:    ${display}`);
    } else {
      formatter.info("Token:    (not found)");
    }
  }
}

async function showEndpoint(
  id: string,
  opts: { showToken?: boolean; config?: boolean },
  deps: CommandDeps,
  jsonMode: boolean,
): Promise<void> {
  try {
    const result = await resolveMcpEndpoint(deps.processManager, id);
    if (opts.config) {
      deps.formatter.json(buildConfig(id, result.endpoint, result.token));
      return;
    }
    renderEndpoint(result, opts, deps.formatter, jsonMode);
  } catch (err) {
    deps.formatter.error(toUserMessage(err));
    process.exitCode = toExitCode(err);
  }
}
