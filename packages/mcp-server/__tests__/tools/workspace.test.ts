import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MechaNotLocatedError } from "@mecha/contracts";
import type { ToolContext } from "../../src/tools/index.js";
import { registerWorkspaceTools } from "../../src/tools/workspace.js";

const mockLocate = vi.fn();
const mockInvalidate = vi.fn();
const mockResolveMcpEndpoint = vi.fn();
const mockAgentFetch = vi.fn();
const mockFetch = vi.fn();

vi.mock("@mecha/service", () => ({
  resolveMcpEndpoint: (...args: unknown[]) => mockResolveMcpEndpoint(...args),
  agentFetch: (...args: unknown[]) => mockAgentFetch(...args),
}));

// Mock global fetch for callContainerMcpTool
vi.stubGlobal("fetch", mockFetch);

function createCtx(): ToolContext {
  return {
    docker: {} as any,
    getNodes: () => [],
    locator: { locate: mockLocate, invalidate: mockInvalidate, clear: vi.fn() } as any,
  };
}

async function callTool(mcpServer: McpServer, name: string, args: Record<string, unknown> = {}): Promise<any> {
  const server = mcpServer as any;
  return server._registeredTools[name].handler(args, {});
}

describe("mesh_workspace_list", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists workspace files for local mecha", async () => {
    mockLocate.mockResolvedValue({ node: "local", id: "mx-a" });
    mockResolveMcpEndpoint.mockResolvedValue({
      endpoint: "http://127.0.0.1:7700/mcp",
      token: "tok123",
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          content: [{ type: "text", text: JSON.stringify([{ name: "file.ts", type: "file" }]) }],
        },
      }),
    });
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerWorkspaceTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_workspace_list", { mecha_id: "mx-a" });
    const data = JSON.parse(result.content[0].text);
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe("file.ts");
    expect(mockFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:7700/mcp",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer tok123" }),
      }),
    );
  });

  it("lists workspace with subdirectory path", async () => {
    mockLocate.mockResolvedValue({ node: "local", id: "mx-a" });
    mockResolveMcpEndpoint.mockResolvedValue({
      endpoint: "http://127.0.0.1:7700/mcp",
      token: "tok",
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          content: [{ type: "text", text: JSON.stringify([{ name: "sub.ts", type: "file" }]) }],
        },
      }),
    });
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerWorkspaceTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_workspace_list", { mecha_id: "mx-a", path: "src" });
    expect(result.isError).toBeUndefined();
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.params.arguments.path).toBe("src");
  });

  it("proxies remote workspace via agent mcp-endpoint", async () => {
    const entry = { name: "gpu-1", host: "10.0.0.1:7660", key: "k1" };
    mockLocate.mockResolvedValue({ node: "gpu-1", id: "mx-b", entry });
    mockAgentFetch.mockResolvedValue({
      json: async () => ({ endpoint: "http://10.0.0.1:7701/mcp", token: "rtok" }),
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          content: [{ type: "text", text: JSON.stringify([{ name: "remote.ts", type: "file" }]) }],
        },
      }),
    });
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerWorkspaceTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_workspace_list", { mecha_id: "mx-b" });
    const data = JSON.parse(result.content[0].text);
    expect(data[0].name).toBe("remote.ts");
    expect(mockAgentFetch).toHaveBeenCalledWith(entry, "/mechas/mx-b/mcp-endpoint");
  });

  it("proxies remote workspace list with path param", async () => {
    const entry = { name: "gpu-1", host: "10.0.0.1:7660", key: "k1" };
    mockLocate.mockResolvedValue({ node: "gpu-1", id: "mx-b", entry });
    mockAgentFetch.mockResolvedValue({
      json: async () => ({ endpoint: "http://10.0.0.1:7701/mcp", token: "t" }),
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          content: [{ type: "text", text: JSON.stringify([{ name: "file.ts", type: "file" }]) }],
        },
      }),
    });
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerWorkspaceTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_workspace_list", { mecha_id: "mx-b", path: "src" });
    expect(result.isError).toBeUndefined();
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.params.arguments.path).toBe("src");
  });

  it("returns error when mecha not found", async () => {
    mockLocate.mockRejectedValue(new MechaNotLocatedError("mx-bad"));
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerWorkspaceTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_workspace_list", { mecha_id: "mx-bad" });
    expect(result.isError).toBe(true);
    expect(mockInvalidate).toHaveBeenCalledWith("mx-bad");
  });

  it("returns error when container MCP request fails", async () => {
    mockLocate.mockResolvedValue({ node: "local", id: "mx-a" });
    mockResolveMcpEndpoint.mockResolvedValue({
      endpoint: "http://127.0.0.1:7700/mcp",
      token: "tok",
    });
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerWorkspaceTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_workspace_list", { mecha_id: "mx-a" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("500");
  });

  it("handles non-text content from container MCP", async () => {
    mockLocate.mockResolvedValue({ node: "local", id: "mx-a" });
    mockResolveMcpEndpoint.mockResolvedValue({
      endpoint: "http://127.0.0.1:7700/mcp",
      token: "tok",
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          content: [{ type: "image", data: "base64data" }],
        },
      }),
    });
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerWorkspaceTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_workspace_list", { mecha_id: "mx-a" });
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    expect(data).toEqual([{ type: "image", data: "base64data" }]);
  });

  it("handles workspace list without token", async () => {
    mockLocate.mockResolvedValue({ node: "local", id: "mx-a" });
    mockResolveMcpEndpoint.mockResolvedValue({
      endpoint: "http://127.0.0.1:7700/mcp",
      token: undefined,
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          content: [{ type: "text", text: "[]" }],
        },
      }),
    });
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerWorkspaceTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_workspace_list", { mecha_id: "mx-a" });
    expect(result.isError).toBeUndefined();
    // Verify no Authorization header was set
    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers.Authorization).toBeUndefined();
  });

  it("returns error when container MCP returns JSON-RPC error", async () => {
    mockLocate.mockResolvedValue({ node: "local", id: "mx-a" });
    mockResolveMcpEndpoint.mockResolvedValue({
      endpoint: "http://127.0.0.1:7700/mcp",
      token: "tok",
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ error: { message: "Path traversal denied" } }),
    });
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerWorkspaceTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_workspace_list", { mecha_id: "mx-a" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Path traversal denied");
  });
});

describe("mesh_workspace_read", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads file from local mecha workspace", async () => {
    mockLocate.mockResolvedValue({ node: "local", id: "mx-a" });
    mockResolveMcpEndpoint.mockResolvedValue({
      endpoint: "http://127.0.0.1:7700/mcp",
      token: "tok",
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          content: [{ type: "text", text: "file contents here" }],
        },
      }),
    });
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerWorkspaceTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_workspace_read", { mecha_id: "mx-a", path: "README.md" });
    // The tool returns textResult("file contents here") since the content is a string
    expect(result.content[0].text).toBe("file contents here");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.params.name).toBe("mecha_workspace_read");
    expect(body.params.arguments.path).toBe("README.md");
  });

  it("reads file from remote mecha workspace", async () => {
    const entry = { name: "gpu-1", host: "10.0.0.1:7660", key: "k1" };
    mockLocate.mockResolvedValue({ node: "gpu-1", id: "mx-b", entry });
    mockAgentFetch.mockResolvedValue({
      json: async () => ({ endpoint: "http://10.0.0.1:7701/mcp", token: "t" }),
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          content: [{ type: "text", text: "remote file content" }],
        },
      }),
    });
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerWorkspaceTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_workspace_read", { mecha_id: "mx-b", path: "src/index.ts" });
    expect(result.content[0].text).toBe("remote file content");
  });

  it("handles non-string result from local workspace read", async () => {
    mockLocate.mockResolvedValue({ node: "local", id: "mx-a" });
    mockResolveMcpEndpoint.mockResolvedValue({
      endpoint: "http://127.0.0.1:7700/mcp",
      token: "tok",
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          content: [{ type: "text", text: JSON.stringify({ error: "binary file" }) }],
        },
      }),
    });
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerWorkspaceTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_workspace_read", { mecha_id: "mx-a", path: "img.png" });
    expect(result.isError).toBeUndefined();
    // Non-string result gets JSON.stringify'd
    expect(result.content[0].text).toContain("binary file");
  });

  it("handles non-string result from remote workspace read", async () => {
    const entry = { name: "gpu-1", host: "10.0.0.1:7660", key: "k1" };
    mockLocate.mockResolvedValue({ node: "gpu-1", id: "mx-b", entry });
    mockAgentFetch.mockResolvedValue({
      json: async () => ({ endpoint: "http://10.0.0.1:7701/mcp", token: "t" }),
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          content: [{ type: "text", text: JSON.stringify({ data: [1, 2, 3] }) }],
        },
      }),
    });
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerWorkspaceTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_workspace_read", { mecha_id: "mx-b", path: "data.json" });
    expect(result.isError).toBeUndefined();
    // JSON-parsed result is an object, so it gets JSON.stringify'd
    expect(result.content[0].text).toContain("[1,2,3]");
  });

  it("returns error for missing mecha", async () => {
    mockLocate.mockRejectedValue(new MechaNotLocatedError("mx-gone"));
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerWorkspaceTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_workspace_read", { mecha_id: "mx-gone", path: "a.txt" });
    expect(result.isError).toBe(true);
  });
});
