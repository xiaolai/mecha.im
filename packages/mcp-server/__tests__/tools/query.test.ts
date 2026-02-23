import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MechaNotLocatedError } from "@mecha/contracts";
import type { ToolContext } from "../../src/tools/index.js";
import { registerQueryTools } from "../../src/tools/query.js";
import { collectSseResponse } from "../../src/tools/query.js";

const mockLocate = vi.fn();
const mockInvalidate = vi.fn();
const mockAgentFetch = vi.fn();
const mockMechaSessionCreate = vi.fn();
const mockRuntimeFetch = vi.fn();

vi.mock("@mecha/service", () => ({
  agentFetch: (...args: unknown[]) => mockAgentFetch(...args),
  mechaSessionCreate: (...args: unknown[]) => mockMechaSessionCreate(...args),
  runtimeFetch: (...args: unknown[]) => mockRuntimeFetch(...args),
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

/** Create a mock Response with an SSE body stream. */
function mockSseResponse(events: string[]): Response {
  const text = events.join("\n") + "\n";
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
  return new Response(stream);
}

describe("collectSseResponse", () => {
  it("extracts text from assistant messages", async () => {
    const res = mockSseResponse([
      'data: {"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}}',
      'data: {"type":"assistant","message":{"content":[{"type":"text","text":" world"}]}}',
    ]);
    const text = await collectSseResponse(res);
    expect(text).toBe("Hello world");
  });

  it("skips non-assistant events", async () => {
    const res = mockSseResponse([
      'data: {"type":"user","message":{"content":"hi"}}',
      'data: {"type":"assistant","message":{"content":[{"type":"text","text":"reply"}]}}',
    ]);
    const text = await collectSseResponse(res);
    expect(text).toBe("reply");
  });

  it("handles [DONE] marker", async () => {
    const res = mockSseResponse([
      'data: {"type":"assistant","message":{"content":[{"type":"text","text":"ok"}]}}',
      "data: [DONE]",
    ]);
    const text = await collectSseResponse(res);
    expect(text).toBe("ok");
  });

  it("skips text blocks with empty text", async () => {
    const res = mockSseResponse([
      'data: {"type":"assistant","message":{"content":[{"type":"text","text":""},{"type":"text","text":"ok"}]}}',
    ]);
    const text = await collectSseResponse(res);
    expect(text).toBe("ok");
  });

  it("skips non-text content blocks", async () => {
    const res = mockSseResponse([
      'data: {"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1"},{"type":"text","text":"done"}]}}',
    ]);
    const text = await collectSseResponse(res);
    expect(text).toBe("done");
  });

  it("skips non-data SSE lines", async () => {
    const res = mockSseResponse([
      "event: heartbeat",
      'data: {"type":"assistant","message":{"content":[{"type":"text","text":"ok"}]}}',
    ]);
    const text = await collectSseResponse(res);
    expect(text).toBe("ok");
  });

  it("returns empty string for bodyless response", async () => {
    const res = new Response(null);
    const text = await collectSseResponse(res);
    expect(text).toBe("");
  });

  it("skips malformed JSON lines", async () => {
    const res = mockSseResponse([
      "data: {invalid json",
      'data: {"type":"assistant","message":{"content":[{"type":"text","text":"ok"}]}}',
    ]);
    const text = await collectSseResponse(res);
    expect(text).toBe("ok");
  });
});

describe("mesh_create_session", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates session on local mecha", async () => {
    mockLocate.mockResolvedValue({ node: "local", id: "mx-a" });
    mockMechaSessionCreate.mockResolvedValue({ id: "s1" });
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerQueryTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_create_session", { mecha_id: "mx-a", title: "My Session" });
    const data = JSON.parse(result.content[0].text);
    expect(data.session_id).toBe("s1");
    expect(data.node).toBe("local");
    expect(mockMechaSessionCreate).toHaveBeenCalledWith(expect.anything(), { id: "mx-a", title: "My Session" });
  });

  it("creates session on remote mecha", async () => {
    const entry = { name: "gpu-1", host: "10.0.0.1:7660", key: "k1" };
    mockLocate.mockResolvedValue({ node: "gpu-1", id: "mx-b", entry });
    mockAgentFetch.mockResolvedValue({
      json: async () => ({ id: "s2" }),
    });
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerQueryTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_create_session", { mecha_id: "mx-b" });
    const data = JSON.parse(result.content[0].text);
    expect(data.session_id).toBe("s2");
    expect(data.node).toBe("gpu-1");
  });

  it("handles sessionId field (fallback from id)", async () => {
    mockLocate.mockResolvedValue({ node: "local", id: "mx-a" });
    mockMechaSessionCreate.mockResolvedValue({ sessionId: "sid1" });
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerQueryTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_create_session", { mecha_id: "mx-a" });
    const data = JSON.parse(result.content[0].text);
    expect(data.session_id).toBe("sid1");
  });

  it("handles remote sessionId field fallback", async () => {
    const entry = { name: "gpu-1", host: "10.0.0.1:7660", key: "k1" };
    mockLocate.mockResolvedValue({ node: "gpu-1", id: "mx-b", entry });
    mockAgentFetch.mockResolvedValue({
      json: async () => ({ sessionId: "rsid1" }),
    });
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerQueryTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_create_session", { mecha_id: "mx-b" });
    const data = JSON.parse(result.content[0].text);
    expect(data.session_id).toBe("rsid1");
  });

  it("returns error when create fails", async () => {
    mockLocate.mockRejectedValue(new MechaNotLocatedError("mx-bad"));
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerQueryTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_create_session", { mecha_id: "mx-bad" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("mx-bad");
  });
});

describe("mesh_query", () => {
  beforeEach(() => vi.clearAllMocks());

  it("queries with existing session_id (local)", async () => {
    mockLocate.mockResolvedValue({ node: "local", id: "mx-a" });
    mockRuntimeFetch.mockResolvedValue(
      mockSseResponse([
        'data: {"type":"assistant","message":{"content":[{"type":"text","text":"Hello!"}]}}',
      ]),
    );
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerQueryTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_query", {
      mecha_id: "mx-a",
      message: "hi",
      session_id: "s1",
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.session_id).toBe("s1");
    expect(data.response).toBe("Hello!");
    expect(mockMechaSessionCreate).not.toHaveBeenCalled();
  });

  it("auto-creates session when session_id omitted (local)", async () => {
    mockLocate.mockResolvedValue({ node: "local", id: "mx-a" });
    mockMechaSessionCreate.mockResolvedValue({ id: "auto-s1" });
    mockRuntimeFetch.mockResolvedValue(
      mockSseResponse([
        'data: {"type":"assistant","message":{"content":[{"type":"text","text":"Response"}]}}',
      ]),
    );
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerQueryTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_query", {
      mecha_id: "mx-a",
      message: "hello",
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.session_id).toBe("auto-s1");
    expect(data.response).toBe("Response");
    expect(mockMechaSessionCreate).toHaveBeenCalled();
  });

  it("queries remote mecha via agent", async () => {
    const entry = { name: "gpu-1", host: "10.0.0.1:7660", key: "k1" };
    mockLocate.mockResolvedValue({ node: "gpu-1", id: "mx-b", entry });
    // First call: create session, Second call: send message
    mockAgentFetch
      .mockResolvedValueOnce({ json: async () => ({ id: "rs1" }) })
      .mockResolvedValueOnce(
        mockSseResponse([
          'data: {"type":"assistant","message":{"content":[{"type":"text","text":"Remote reply"}]}}',
        ]),
      );
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerQueryTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_query", {
      mecha_id: "mx-b",
      message: "test",
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.session_id).toBe("rs1");
    expect(data.response).toBe("Remote reply");
    expect(mockAgentFetch).toHaveBeenCalledTimes(2);
  });

  it("auto-creates session with sessionId field fallback (local)", async () => {
    mockLocate.mockResolvedValue({ node: "local", id: "mx-a" });
    mockMechaSessionCreate.mockResolvedValue({ sessionId: "sid-fallback" });
    mockRuntimeFetch.mockResolvedValue(
      mockSseResponse([
        'data: {"type":"assistant","message":{"content":[{"type":"text","text":"ok"}]}}',
      ]),
    );
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerQueryTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_query", { mecha_id: "mx-a", message: "hi" });
    const data = JSON.parse(result.content[0].text);
    expect(data.session_id).toBe("sid-fallback");
  });

  it("auto-creates session with sessionId field fallback (remote)", async () => {
    const entry = { name: "gpu-1", host: "10.0.0.1:7660", key: "k1" };
    mockLocate.mockResolvedValue({ node: "gpu-1", id: "mx-b", entry });
    mockAgentFetch
      .mockResolvedValueOnce({ json: async () => ({ sessionId: "rsid-fb" }) })
      .mockResolvedValueOnce(
        mockSseResponse([
          'data: {"type":"assistant","message":{"content":[{"type":"text","text":"remote"}]}}',
        ]),
      );
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerQueryTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_query", { mecha_id: "mx-b", message: "hi" });
    const data = JSON.parse(result.content[0].text);
    expect(data.session_id).toBe("rsid-fb");
  });

  it("queries remote with existing session_id", async () => {
    const entry = { name: "gpu-1", host: "10.0.0.1:7660", key: "k1" };
    mockLocate.mockResolvedValue({ node: "gpu-1", id: "mx-b", entry });
    mockAgentFetch.mockResolvedValue(
      mockSseResponse([
        'data: {"type":"assistant","message":{"content":[{"type":"text","text":"hi back"}]}}',
      ]),
    );
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerQueryTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_query", {
      mecha_id: "mx-b",
      message: "hello",
      session_id: "existing-sid",
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.session_id).toBe("existing-sid");
    expect(data.response).toBe("hi back");
    expect(mockAgentFetch).toHaveBeenCalledTimes(1); // no session create call
  });

  it("returns (no response) for empty stream", async () => {
    mockLocate.mockResolvedValue({ node: "local", id: "mx-a" });
    mockRuntimeFetch.mockResolvedValue(mockSseResponse([]));
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerQueryTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_query", {
      mecha_id: "mx-a",
      message: "hi",
      session_id: "s1",
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.response).toBe("(no response)");
  });

  it("returns error when mecha not found", async () => {
    mockLocate.mockRejectedValue(new MechaNotLocatedError("mx-bad"));
    const mcpServer = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
    registerQueryTools(mcpServer, createCtx());

    const result = await callTool(mcpServer, "mesh_query", {
      mecha_id: "mx-bad",
      message: "hi",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("mx-bad");
  });
});
