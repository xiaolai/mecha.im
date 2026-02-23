import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MechaNotLocatedError, NodeUnreachableError } from "@mecha/contracts";
import type { ToolContext } from "../../src/tools/index.js";
import { registerMechaTools } from "../../src/tools/mechas.js";

const mockMechaLs = vi.fn();
const mockMechaStatus = vi.fn();
const mockAgentFetch = vi.fn();
const mockLocate = vi.fn();
const mockInvalidate = vi.fn();

vi.mock("@mecha/service", () => ({
  mechaLs: (...args: unknown[]) => mockMechaLs(...args),
  mechaStatus: (...args: unknown[]) => mockMechaStatus(...args),
  agentFetch: (...args: unknown[]) => mockAgentFetch(...args),
}));

function createCtx(nodes: Array<{ name: string; host: string; key: string }> = []): ToolContext {
  return {
    docker: {} as any,
    getNodes: () => nodes,
    locator: { locate: mockLocate, invalidate: mockInvalidate, clear: vi.fn() } as any,
  };
}

async function callTool(mcpServer: McpServer, name: string, args: Record<string, unknown> = {}): Promise<any> {
  const server = mcpServer as any;
  const tool = server._registeredTools[name];
  return tool.handler(args, {});
}

describe("mesh_list_mechas", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists local mechas", async () => {
    mockMechaLs.mockResolvedValue([
      { id: "mx-a", name: "mecha-mx-a", state: "running", path: "/projects/a", port: 7700 },
    ]);
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerMechaTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_list_mechas", {});
    const data = JSON.parse(result.content[0].text);
    expect(data).toHaveLength(1);
    expect(data[0].node).toBe("local");
    expect(data[0].id).toBe("mx-a");
    expect(data[0].state).toBe("running");
  });

  it("lists remote mechas", async () => {
    mockMechaLs.mockResolvedValue([]);
    mockAgentFetch.mockResolvedValue({
      json: async () => [{ id: "mx-b", name: "mecha-mx-b", state: "running", path: "/p" }],
    });
    const nodes = [{ name: "gpu-1", host: "10.0.0.1:7660", key: "k1" }];
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerMechaTools(mcpServer, createCtx(nodes));

    const result = await callTool(mcpServer, "mesh_list_mechas", {});
    const data = JSON.parse(result.content[0].text);
    expect(data).toHaveLength(1);
    expect(data[0].node).toBe("gpu-1");
    expect(data[0].id).toBe("mx-b");
  });

  it("filters by node name", async () => {
    mockMechaLs.mockResolvedValue([
      { id: "mx-a", name: "mecha-mx-a", state: "running", path: "/p", port: 7700 },
    ]);
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerMechaTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_list_mechas", { node: "gpu-1" });
    const data = JSON.parse(result.content[0].text);
    expect(data).toHaveLength(0); // local excluded because filter is "gpu-1"
  });

  it("filters to local node only", async () => {
    mockMechaLs.mockResolvedValue([
      { id: "mx-a", name: "n", state: "running", path: "/p", port: 7700 },
    ]);
    const nodes = [{ name: "gpu-1", host: "10.0.0.1:7660", key: "k1" }];
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerMechaTools(mcpServer, createCtx(nodes));

    const result = await callTool(mcpServer, "mesh_list_mechas", { node: "local" });
    const data = JSON.parse(result.content[0].text);
    expect(data).toHaveLength(1);
    expect(data[0].node).toBe("local");
    // agentFetch should not be called since we filtered to "local"
    expect(mockAgentFetch).not.toHaveBeenCalled();
  });

  it("skips unreachable remote nodes", async () => {
    mockMechaLs.mockResolvedValue([
      { id: "mx-a", name: "n", state: "running", path: "/p", port: 7700 },
    ]);
    mockAgentFetch.mockRejectedValue(new NodeUnreachableError("gpu-1"));
    const nodes = [{ name: "gpu-1", host: "10.0.0.1:7660", key: "k1" }];
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerMechaTools(mcpServer, createCtx(nodes));

    const result = await callTool(mcpServer, "mesh_list_mechas", {});
    const data = JSON.parse(result.content[0].text);
    expect(data).toHaveLength(1);
    expect(data[0].node).toBe("local");
  });

  it("returns error for non-connectivity remote failures", async () => {
    mockMechaLs.mockResolvedValue([]);
    mockAgentFetch.mockRejectedValue(new Error("auth failed"));
    const nodes = [{ name: "gpu-1", host: "10.0.0.1:7660", key: "k1" }];
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerMechaTools(mcpServer, createCtx(nodes));

    const result = await callTool(mcpServer, "mesh_list_mechas", {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("auth failed");
  });
});

describe("mesh_mecha_status", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns local mecha status", async () => {
    mockLocate.mockResolvedValue({ node: "local", id: "mx-a" });
    mockMechaStatus.mockResolvedValue({
      id: "mx-a",
      name: "mecha-mx-a",
      state: "running",
      running: true,
      port: 7700,
      path: "/p",
    });
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerMechaTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_mecha_status", { mecha_id: "mx-a" });
    const data = JSON.parse(result.content[0].text);
    expect(data.node).toBe("local");
    expect(data.id).toBe("mx-a");
    expect(data.running).toBe(true);
  });

  it("returns remote mecha status via agent", async () => {
    const entry = { name: "gpu-1", host: "10.0.0.1:7660", key: "k1" };
    mockLocate.mockResolvedValue({ node: "gpu-1", id: "mx-b", entry });
    mockAgentFetch.mockResolvedValue({
      json: async () => ({ id: "mx-b", state: "running" }),
    });
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerMechaTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_mecha_status", { mecha_id: "mx-b" });
    const data = JSON.parse(result.content[0].text);
    expect(data.node).toBe("gpu-1");
  });

  it("returns error when mecha not found", async () => {
    mockLocate.mockRejectedValue(new MechaNotLocatedError("mx-bad"));
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerMechaTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_mecha_status", { mecha_id: "mx-bad" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("mx-bad");
    expect(mockInvalidate).toHaveBeenCalledWith("mx-bad");
  });
});
