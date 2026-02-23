import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer, type McpServerHandle, type CreateMcpServerOptions } from "../src/mcp/server.js";
import type { SessionManager } from "../src/agent/session-manager.js";

const TEST_ID = "mx-test-abc123";

function createMockSessionManager(overrides?: Partial<SessionManager>): SessionManager {
  return {
    create: vi.fn().mockReturnValue({
      sessionId: "s-new-123",
      title: "Test",
      state: "idle",
      messageCount: 0,
      lastMessageAt: null,
      createdAt: "2025-01-01T00:00:00Z",
    }),
    list: vi.fn().mockReturnValue([
      { sessionId: "s1", title: "Test", state: "idle", messageCount: 0, lastMessageAt: null, createdAt: "2025-01-01T00:00:00Z" },
    ]),
    delete: vi.fn().mockReturnValue(true),
    sendMessage: vi.fn().mockReturnValue((async function* () {
      yield {
        type: "assistant",
        message: { content: [{ type: "text", text: "Agent reply" }] },
      };
    })()),
    ...overrides,
  } as unknown as SessionManager;
}

function makeHandle(overrides?: Partial<CreateMcpServerOptions>): McpServerHandle {
  return createMcpServer({ mechaId: TEST_ID, ...overrides });
}

async function connectClient(handle: McpServerHandle): Promise<Client> {
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await handle.mcpServer.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

describe("MCP server", () => {
  it("creates an MCP server with mecha name", () => {
    const handle = makeHandle();
    expect(handle.mcpServer).toBeDefined();
  });
});

describe("MCP tools - mecha_status", () => {
  let handle: McpServerHandle;
  let client: Client;

  beforeAll(async () => {
    handle = makeHandle();
    client = await connectClient(handle);
  });

  afterAll(async () => {
    await client.close();
  });

  it("returns running status with timestamp", async () => {
    const result = await client.callTool({ name: "mecha_status", arguments: {} });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content).toHaveLength(1);
    expect(content[0]!.type).toBe("text");
    const parsed = JSON.parse(content[0]!.text);
    expect(parsed.status).toBe("running");
    expect(parsed.timestamp).toBeDefined();
  });
});

describe("MCP tools - mecha_workspace_list", () => {
  let handle: McpServerHandle;
  let client: Client;

  beforeAll(async () => {
    handle = makeHandle();
    client = await connectClient(handle);
  });

  afterAll(async () => {
    await client.close();
  });

  it("returns text content for workspace root", async () => {
    const result = await client.callTool({
      name: "mecha_workspace_list",
      arguments: {},
    });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content).toHaveLength(1);
    // Will error because /home/mecha doesn't exist in test env, but returns text
    expect(content[0]!.type).toBe("text");
  });

  it("rejects path traversal", async () => {
    const result = await client.callTool({
      name: "mecha_workspace_list",
      arguments: { path: "../../etc" },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]!.text).toContain("path traversal denied");
    expect(result.isError).toBe(true);
  });
});

describe("MCP tools - mecha_workspace_read", () => {
  let handle: McpServerHandle;
  let client: Client;

  beforeAll(async () => {
    handle = makeHandle();
    client = await connectClient(handle);
  });

  afterAll(async () => {
    await client.close();
  });

  it("rejects path traversal", async () => {
    const result = await client.callTool({
      name: "mecha_workspace_read",
      arguments: { path: "../../../etc/passwd" },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]!.text).toContain("path traversal denied");
    expect(result.isError).toBe(true);
  });

  it("returns error for non-existent file", async () => {
    const result = await client.callTool({
      name: "mecha_workspace_read",
      arguments: { path: "nonexistent.txt" },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]!.text).toContain("Error:");
    expect(result.isError).toBe(true);
  });
});

describe("MCP tools - mecha_chat", () => {
  it("sends message via sessionManager and returns response text", async () => {
    const sm = createMockSessionManager();
    const handle = makeHandle({ sessionManager: sm });
    const client = await connectClient(handle);

    const result = await client.callTool({
      name: "mecha_chat",
      arguments: { message: "Hello agent" },
    });

    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]!.text).toBe("Agent reply");
    expect(result.isError).toBeUndefined();
    expect(sm.create).toHaveBeenCalledOnce();
    expect(sm.sendMessage).toHaveBeenCalledWith("s-new-123", "Hello agent");
    // Verify session is cleaned up after chat
    expect(sm.delete).toHaveBeenCalledWith("s-new-123");

    await client.close();
  });

  it("returns error when sessionManager throws and still cleans up session", async () => {
    const sm = createMockSessionManager({
      sendMessage: vi.fn().mockReturnValue((async function* () {
        throw new Error("Connection refused");
      })()),
    });
    const handle = makeHandle({ sessionManager: sm });
    const client = await connectClient(handle);

    const result = await client.callTool({
      name: "mecha_chat",
      arguments: { message: "Hello" },
    });

    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]!.text).toContain("Chat request failed:");
    expect(content[0]!.text).toContain("Connection refused");
    expect(result.isError).toBe(true);
    // Session should still be cleaned up even on error
    expect(sm.delete).toHaveBeenCalledWith("s-new-123");

    await client.close();
  });

  it("returns error when no sessionManager", async () => {
    const handle = makeHandle();
    const client = await connectClient(handle);

    const result = await client.callTool({
      name: "mecha_chat",
      arguments: { message: "Hello" },
    });

    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]!.text).toBe("Sessions not available");
    expect(result.isError).toBe(true);

    await client.close();
  });

  it("returns (no response) when stream yields no text", async () => {
    const sm = createMockSessionManager({
      sendMessage: vi.fn().mockReturnValue((async function* () {
        yield { type: "other", data: {} };
      })()),
    });
    const handle = makeHandle({ sessionManager: sm });
    const client = await connectClient(handle);

    const result = await client.callTool({
      name: "mecha_chat",
      arguments: { message: "Hello" },
    });

    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]!.text).toBe("(no response)");

    await client.close();
  });
});

describe("MCP tools - session management", () => {
  it("mecha_session_list returns sessions array", async () => {
    const sm = createMockSessionManager();
    const handle = makeHandle({ sessionManager: sm });
    const client = await connectClient(handle);

    const result = await client.callTool({
      name: "mecha_session_list",
      arguments: {},
    });

    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0]!.text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].sessionId).toBe("s1");

    await client.close();
  });

  it("mecha_session_list returns error when no sessionManager", async () => {
    const handle = makeHandle();
    const client = await connectClient(handle);

    const result = await client.callTool({
      name: "mecha_session_list",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    await client.close();
  });

  it("mecha_session_list returns error on exception", async () => {
    const sm = createMockSessionManager({
      list: vi.fn().mockImplementation(() => { throw new Error("DB error"); }),
    });
    const handle = makeHandle({ sessionManager: sm });
    const client = await connectClient(handle);

    const result = await client.callTool({
      name: "mecha_session_list",
      arguments: {},
    });

    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]!.text).toContain("DB error");
    expect(result.isError).toBe(true);
    await client.close();
  });

  it("mecha_session_create creates and returns session", async () => {
    const sm = createMockSessionManager();
    const handle = makeHandle({ sessionManager: sm });
    const client = await connectClient(handle);

    const result = await client.callTool({
      name: "mecha_session_create",
      arguments: { title: "My Session" },
    });

    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0]!.text);
    expect(parsed.sessionId).toBe("s-new-123");
    expect(sm.create).toHaveBeenCalledWith({ title: "My Session" });

    await client.close();
  });

  it("mecha_session_create handles error", async () => {
    const sm = createMockSessionManager({
      create: vi.fn().mockImplementation(() => { throw new Error("Cap reached"); }),
    });
    const handle = makeHandle({ sessionManager: sm });
    const client = await connectClient(handle);

    const result = await client.callTool({
      name: "mecha_session_create",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    await client.close();
  });

  it("mecha_session_message sends message in session", async () => {
    const sm = createMockSessionManager();
    const handle = makeHandle({ sessionManager: sm });
    const client = await connectClient(handle);

    const result = await client.callTool({
      name: "mecha_session_message",
      arguments: { sessionId: "s1", message: "Hello" },
    });

    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]!.text).toBe("Agent reply");
    expect(sm.sendMessage).toHaveBeenCalledWith("s1", "Hello");

    await client.close();
  });

  it("mecha_session_message handles error", async () => {
    const sm = createMockSessionManager({
      sendMessage: vi.fn().mockReturnValue((async function* () {
        throw new Error("Not found");
      })()),
    });
    const handle = makeHandle({ sessionManager: sm });
    const client = await connectClient(handle);

    const result = await client.callTool({
      name: "mecha_session_message",
      arguments: { sessionId: "bad-id", message: "Hello" },
    });

    expect(result.isError).toBe(true);
    await client.close();
  });

  it("mecha_session_delete removes session", async () => {
    const sm = createMockSessionManager();
    const handle = makeHandle({ sessionManager: sm });
    const client = await connectClient(handle);

    const result = await client.callTool({
      name: "mecha_session_delete",
      arguments: { sessionId: "s1" },
    });

    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0]!.text);
    expect(parsed.deleted).toBe(true);
    expect(parsed.sessionId).toBe("s1");
    expect(sm.delete).toHaveBeenCalledWith("s1");

    await client.close();
  });

  it("mecha_session_delete handles error", async () => {
    const sm = createMockSessionManager({
      delete: vi.fn().mockImplementation(() => { throw new Error("Not found"); }),
    });
    const handle = makeHandle({ sessionManager: sm });
    const client = await connectClient(handle);

    const result = await client.callTool({
      name: "mecha_session_delete",
      arguments: { sessionId: "bad-id" },
    });

    expect(result.isError).toBe(true);
    await client.close();
  });
});
