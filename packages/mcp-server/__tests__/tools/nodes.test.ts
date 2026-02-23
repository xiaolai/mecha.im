import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NodeUnreachableError, NodeAuthFailedError } from "@mecha/contracts";
import type { ToolContext } from "../../src/tools/index.js";
import { registerNodeTools } from "../../src/tools/nodes.js";

const mockAgentFetch = vi.fn();

vi.mock("@mecha/service", () => ({
  agentFetch: (...args: unknown[]) => mockAgentFetch(...args),
}));

function createCtx(nodes: Array<{ name: string; host: string; key: string }> = []): ToolContext {
  return {
    docker: {} as any,
    getNodes: () => nodes,
    locator: { locate: vi.fn(), invalidate: vi.fn(), clear: vi.fn() } as any,
  };
}

async function callTool(mcpServer: McpServer, name: string, args: Record<string, unknown> = {}): Promise<any> {
  const server = mcpServer as any;
  const tool = server._registeredTools[name];
  return tool.handler(args, {});
}

describe("mesh_list_nodes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns empty array when no nodes", async () => {
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerNodeTools(mcpServer, createCtx([]));

    const result = await callTool(mcpServer, "mesh_list_nodes");
    const data = JSON.parse(result.content[0].text);
    expect(data).toEqual([]);
    expect(result.isError).toBeUndefined();
  });

  it("returns online status for reachable node", async () => {
    mockAgentFetch.mockResolvedValue({ ok: true });
    const nodes = [{ name: "gpu-1", host: "10.0.0.1:7660", key: "k1" }];
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerNodeTools(mcpServer, createCtx(nodes));

    const result = await callTool(mcpServer, "mesh_list_nodes");
    const data = JSON.parse(result.content[0].text);
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe("gpu-1");
    expect(data[0].status).toBe("online");
    expect(data[0].latencyMs).toBeGreaterThanOrEqual(0);
    expect(mockAgentFetch).toHaveBeenCalledWith(nodes[0], "/healthz", { timeoutMs: 3000 });
  });

  it("returns offline status for unreachable node", async () => {
    mockAgentFetch.mockRejectedValue(new NodeUnreachableError("gpu-2"));
    const nodes = [{ name: "gpu-2", host: "10.0.0.2:7660", key: "k2" }];
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerNodeTools(mcpServer, createCtx(nodes));

    const result = await callTool(mcpServer, "mesh_list_nodes");
    const data = JSON.parse(result.content[0].text);
    expect(data).toHaveLength(1);
    expect(data[0].status).toBe("offline");
    expect(data[0].latencyMs).toBeNull();
  });

  it("checks all nodes in parallel", async () => {
    mockAgentFetch
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new NodeUnreachableError("gpu-2"));
    const nodes = [
      { name: "gpu-1", host: "10.0.0.1:7660", key: "k1" },
      { name: "gpu-2", host: "10.0.0.2:7660", key: "k2" },
    ];
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerNodeTools(mcpServer, createCtx(nodes));

    const result = await callTool(mcpServer, "mesh_list_nodes");
    const data = JSON.parse(result.content[0].text);
    expect(data).toHaveLength(2);
    expect(data[0].status).toBe("online");
    expect(data[1].status).toBe("offline");
  });

  it("returns error for non-connectivity failures", async () => {
    mockAgentFetch.mockRejectedValue(new NodeAuthFailedError("gpu-1"));
    const nodes = [{ name: "gpu-1", host: "10.0.0.1:7660", key: "k1" }];
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerNodeTools(mcpServer, createCtx(nodes));

    const result = await callTool(mcpServer, "mesh_list_nodes");
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Error:");
  });
});
