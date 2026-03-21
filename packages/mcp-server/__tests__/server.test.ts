import { describe, it, expect, vi } from "vitest";
import { createMeshMcpServer } from "../src/server.js";
import type { MeshMcpContext } from "../src/types.js";

function makeCtx(overrides: Partial<MeshMcpContext> = {}): MeshMcpContext {
  return {
    mechaDir: "/tmp/mecha",
    pm: { get: vi.fn(), list: vi.fn().mockReturnValue([]), getPortAndToken: vi.fn() } as never,
    getNodes: vi.fn().mockReturnValue([]),
    agentFetch: vi.fn() as never,
    mode: "query",
    audit: { append: vi.fn(), read: vi.fn().mockReturnValue([]), clear: vi.fn() },
    rateLimiter: { check: vi.fn().mockReturnValue(true), remaining: vi.fn().mockReturnValue(100) },
    ...overrides,
  };
}

type ToolRegistry = Record<string, { handler: unknown }>;

describe("createMeshMcpServer", () => {
  it("creates a server with all 9 tools in query mode", () => {
    const ctx = makeCtx({ mode: "query" });
    const server = createMeshMcpServer(ctx);
    expect(server).toBeDefined();
    const tools = (server as unknown as { _registeredTools: ToolRegistry })._registeredTools;
    const toolNames = Object.keys(tools);
    expect(toolNames).toHaveLength(9);
    expect(toolNames).toContain("mecha_list_nodes");
    expect(toolNames).toContain("mecha_list_bots");
    expect(toolNames).toContain("mecha_bot_status");
    expect(toolNames).toContain("mecha_discover");
    expect(toolNames).toContain("mecha_list_sessions");
    expect(toolNames).toContain("mecha_get_session");
    expect(toolNames).toContain("mecha_workspace_list");
    expect(toolNames).toContain("mecha_workspace_read");
    expect(toolNames).toContain("mecha_query");
  });

  it("creates a server with 8 tools in read-only mode", () => {
    const ctx = makeCtx({ mode: "read-only" });
    const server = createMeshMcpServer(ctx);
    const tools = (server as unknown as { _registeredTools: ToolRegistry })._registeredTools;
    const toolNames = Object.keys(tools);
    expect(toolNames).toHaveLength(8);
    expect(toolNames).not.toContain("mecha_query");
  });
});
