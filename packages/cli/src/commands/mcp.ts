import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { registerMcpServeCommand } from "./mcp-serve.js";
import { registerMcpConfigCommand } from "./mcp-config.js";

/** Register the 'mcp' command group. */
export function registerMcpCommand(program: Command, deps: CommandDeps): void {
  const mcp = program
    .command("mcp")
    .description("Mesh MCP server management");

  registerMcpServeCommand(mcp, deps);
  registerMcpConfigCommand(mcp, deps);
}
