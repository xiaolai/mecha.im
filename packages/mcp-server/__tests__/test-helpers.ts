import { vi } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createMeshMcpServer } from "../src/server.js";
import type { MeshMcpContext } from "../src/types.js";

type ToolHandler = (args: Record<string, unknown>) => Promise<CallToolResult>;
type ToolRegistry = Record<string, { handler: ToolHandler }>;

export function makeCtx(overrides: Partial<MeshMcpContext> = {}): MeshMcpContext {
  return {
    mechaDir: "/tmp/mecha",
    pm: {
      get: vi.fn().mockReturnValue(undefined),
      list: vi.fn().mockReturnValue([]),
      getPortAndToken: vi.fn(),
    } as never,
    getNodes: vi.fn().mockReturnValue([]),
    agentFetch: vi.fn() as never,
    mode: "query",
    audit: { append: vi.fn(), read: vi.fn().mockReturnValue([]), clear: vi.fn() },
    rateLimiter: { check: vi.fn().mockReturnValue(true), remaining: vi.fn().mockReturnValue(100) },
    ...overrides,
  };
}

export async function callTool(
  ctx: MeshMcpContext,
  toolName: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const server = createMeshMcpServer(ctx);
  const tools = (server as unknown as { _registeredTools: ToolRegistry })._registeredTools;
  const tool = tools[toolName];
  if (!tool) throw new Error(`Tool not found: ${toolName}`);
  return tool.handler(args);
}

export function getText(result: CallToolResult): string {
  const first = result.content[0];
  if (first && "text" in first) return first.text;
  return "";
}
