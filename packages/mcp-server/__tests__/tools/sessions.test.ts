import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MechaNotLocatedError, SessionNotFoundError } from "@mecha/contracts";
import type { ToolContext } from "../../src/tools/index.js";
import { registerSessionTools } from "../../src/tools/sessions.js";

const mockLocate = vi.fn();
const mockInvalidate = vi.fn();
const mockRemoteSessionList = vi.fn();
const mockRemoteSessionGet = vi.fn();

vi.mock("@mecha/service", () => ({
  remoteSessionList: (...args: unknown[]) => mockRemoteSessionList(...args),
  remoteSessionGet: (...args: unknown[]) => mockRemoteSessionGet(...args),
}));

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

describe("mesh_list_sessions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists sessions for local mecha", async () => {
    mockLocate.mockResolvedValue({ node: "local", id: "mx-a" });
    mockRemoteSessionList.mockResolvedValue({
      sessions: [{ id: "s1", title: "Test" }],
      meta: {},
    });
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerSessionTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_list_sessions", { mecha_id: "mx-a" });
    const data = JSON.parse(result.content[0].text);
    expect(data.sessions).toHaveLength(1);
    expect(mockRemoteSessionList).toHaveBeenCalledWith(
      expect.anything(), "mx-a", { node: "local", entry: undefined },
    );
  });

  it("lists sessions for remote mecha", async () => {
    const entry = { name: "gpu-1", host: "10.0.0.1:7660", key: "k1" };
    mockLocate.mockResolvedValue({ node: "gpu-1", id: "mx-b", entry });
    mockRemoteSessionList.mockResolvedValue({ sessions: [], meta: {} });
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerSessionTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_list_sessions", { mecha_id: "mx-b" });
    expect(mockRemoteSessionList).toHaveBeenCalledWith(
      expect.anything(), "mx-b", { node: "gpu-1", entry },
    );
    expect(result.isError).toBeUndefined();
  });

  it("returns error when mecha not found", async () => {
    mockLocate.mockRejectedValue(new MechaNotLocatedError("mx-bad"));
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerSessionTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_list_sessions", { mecha_id: "mx-bad" });
    expect(result.isError).toBe(true);
    expect(mockInvalidate).toHaveBeenCalledWith("mx-bad");
  });
});

describe("mesh_get_session", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns session with messages when requested", async () => {
    mockLocate.mockResolvedValue({ node: "local", id: "mx-a" });
    mockRemoteSessionGet.mockResolvedValue({
      id: "s1",
      title: "Test",
      messages: [{ role: "user", content: "hi" }],
    });
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerSessionTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_get_session", {
      mecha_id: "mx-a",
      session_id: "s1",
      include_messages: true,
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.messages).toBeDefined();
    expect(data.messages).toHaveLength(1);
  });

  it("strips messages by default", async () => {
    mockLocate.mockResolvedValue({ node: "local", id: "mx-a" });
    mockRemoteSessionGet.mockResolvedValue({
      id: "s1",
      title: "Test",
      messages: [{ role: "user", content: "hi" }],
    });
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerSessionTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_get_session", {
      mecha_id: "mx-a",
      session_id: "s1",
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.messages).toBeUndefined();
    expect(data.id).toBe("s1");
  });

  it("returns error when session not found", async () => {
    mockLocate.mockResolvedValue({ node: "local", id: "mx-a" });
    mockRemoteSessionGet.mockRejectedValue(new SessionNotFoundError("s-bad"));
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerSessionTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_get_session", {
      mecha_id: "mx-a",
      session_id: "s-bad",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("s-bad");
    expect(mockInvalidate).toHaveBeenCalledWith("mx-a");
  });
});
