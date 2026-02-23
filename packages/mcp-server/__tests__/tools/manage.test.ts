import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MechaNotLocatedError, SessionNotFoundError } from "@mecha/contracts";
import type { ToolContext } from "../../src/tools/index.js";
import { registerManageTools } from "../../src/tools/manage.js";

const mockLocate = vi.fn();
const mockInvalidate = vi.fn();
const mockRemoteSessionDelete = vi.fn();
const mockRemoteSessionMetaUpdate = vi.fn();

vi.mock("@mecha/service", () => ({
  remoteSessionDelete: (...args: unknown[]) => mockRemoteSessionDelete(...args),
  remoteSessionMetaUpdate: (...args: unknown[]) => mockRemoteSessionMetaUpdate(...args),
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

describe("mesh_delete_session", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes local session", async () => {
    mockLocate.mockResolvedValue({ node: "local", id: "mx-a" });
    mockRemoteSessionDelete.mockResolvedValue(undefined);
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerManageTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_delete_session", {
      mecha_id: "mx-a",
      session_id: "s1",
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.deleted).toBe(true);
    expect(mockRemoteSessionDelete).toHaveBeenCalledWith(
      expect.anything(), "mx-a", "s1", { node: "local", entry: undefined },
    );
  });

  it("deletes remote session", async () => {
    const entry = { name: "gpu-1", host: "10.0.0.1:7660", key: "k1" };
    mockLocate.mockResolvedValue({ node: "gpu-1", id: "mx-b", entry });
    mockRemoteSessionDelete.mockResolvedValue(undefined);
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerManageTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_delete_session", {
      mecha_id: "mx-b",
      session_id: "s2",
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.deleted).toBe(true);
    expect(mockRemoteSessionDelete).toHaveBeenCalledWith(
      expect.anything(), "mx-b", "s2", { node: "gpu-1", entry },
    );
  });

  it("returns error when session not found", async () => {
    mockLocate.mockResolvedValue({ node: "local", id: "mx-a" });
    mockRemoteSessionDelete.mockRejectedValue(new SessionNotFoundError("s-bad"));
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerManageTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_delete_session", {
      mecha_id: "mx-a",
      session_id: "s-bad",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("s-bad");
    expect(mockInvalidate).toHaveBeenCalledWith("mx-a");
  });
});

describe("mesh_star_session", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stars local session", async () => {
    mockLocate.mockResolvedValue({ node: "local", id: "mx-a" });
    mockRemoteSessionMetaUpdate.mockResolvedValue(undefined);
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerManageTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_star_session", {
      mecha_id: "mx-a",
      session_id: "s1",
      starred: true,
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.ok).toBe(true);
    expect(mockRemoteSessionMetaUpdate).toHaveBeenCalledWith(
      "mx-a", "s1", { starred: true }, { node: "local", entry: undefined },
    );
  });

  it("returns error when star fails", async () => {
    mockLocate.mockRejectedValue(new MechaNotLocatedError("mx-bad"));
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerManageTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_star_session", {
      mecha_id: "mx-bad",
      session_id: "s1",
      starred: true,
    });
    expect(result.isError).toBe(true);
    expect(mockInvalidate).toHaveBeenCalledWith("mx-bad");
  });

  it("unstars remote session", async () => {
    const entry = { name: "gpu-1", host: "10.0.0.1:7660", key: "k1" };
    mockLocate.mockResolvedValue({ node: "gpu-1", id: "mx-b", entry });
    mockRemoteSessionMetaUpdate.mockResolvedValue(undefined);
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerManageTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_star_session", {
      mecha_id: "mx-b",
      session_id: "s2",
      starred: false,
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.ok).toBe(true);
  });
});

describe("mesh_rename_session", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renames local session", async () => {
    mockLocate.mockResolvedValue({ node: "local", id: "mx-a" });
    mockRemoteSessionMetaUpdate.mockResolvedValue(undefined);
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerManageTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_rename_session", {
      mecha_id: "mx-a",
      session_id: "s1",
      title: "New Title",
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.ok).toBe(true);
    expect(mockRemoteSessionMetaUpdate).toHaveBeenCalledWith(
      "mx-a", "s1", { customTitle: "New Title" }, { node: "local", entry: undefined },
    );
  });

  it("renames remote session", async () => {
    const entry = { name: "gpu-1", host: "10.0.0.1:7660", key: "k1" };
    mockLocate.mockResolvedValue({ node: "gpu-1", id: "mx-b", entry });
    mockRemoteSessionMetaUpdate.mockResolvedValue(undefined);
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerManageTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_rename_session", {
      mecha_id: "mx-b",
      session_id: "s2",
      title: "Renamed",
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.ok).toBe(true);
  });

  it("returns error when mecha not found", async () => {
    mockLocate.mockRejectedValue(new MechaNotLocatedError("mx-bad"));
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerManageTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_rename_session", {
      mecha_id: "mx-bad",
      session_id: "s1",
      title: "New",
    });
    expect(result.isError).toBe(true);
    expect(mockInvalidate).toHaveBeenCalledWith("mx-bad");
  });
});
