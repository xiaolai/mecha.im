import { describe, it, expect, vi, afterEach } from "vitest";
import { makeCtx, callTool, getText } from "../test-helpers.js";
import { createMeshMcpServer } from "../../src/server.js";
import type { MeshMcpContext } from "../../src/types.js";

type ToolRegistry = Record<string, { handler: unknown }>;

/** Create a context with a running local bot. */
function makeLocalBotCtx(overrides: Partial<MeshMcpContext> = {}) {
  return makeCtx({
    pm: {
      get: vi.fn().mockReturnValue({ name: "bot-a", state: "running", port: 7700 }),
      list: vi.fn().mockReturnValue([]),
      getPortAndToken: vi.fn().mockReturnValue({ port: 7700, token: "tok123" }),
    } as never,
    ...overrides,
  });
}

/** Create a context with a remote node. */
function makeRemoteCtx(
  agentFetch: MeshMcpContext["agentFetch"],
  overrides: Partial<MeshMcpContext> = {},
) {
  return makeCtx({
    getNodes: vi.fn().mockReturnValue([
      { name: "spark01", host: "100.100.1.5", port: 7660, apiKey: "key123" },
    ]),
    agentFetch: agentFetch as never,
    ...overrides,
  });
}

/** Stub global fetch to return a JSON bot response. */
function stubFetchJson(response: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => response,
  }));
}

// Ensure global stubs are cleaned up even if assertions fail
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mecha_query", () => {
  // --- Registration ---

  it("is only registered in query mode", () => {
    const readOnlyCtx = makeCtx({ mode: "read-only" });
    const server = createMeshMcpServer(readOnlyCtx);
    const tools = (server as unknown as { _registeredTools: ToolRegistry })._registeredTools;
    expect(Object.keys(tools)).not.toContain("mecha_query");
  });

  // --- Input validation ---

  it("returns error when target is missing", async () => {
    const ctx = makeCtx();
    const result = await callTool(ctx, "mecha_query", { message: "hello" });
    expect(result.isError).toBe(true);
    expect(getText(result)).toMatch(/target/i);
  });

  it("returns error when message is missing", async () => {
    const ctx = makeCtx();
    const result = await callTool(ctx, "mecha_query", { target: "bot-a" });
    expect(result.isError).toBe(true);
    expect(getText(result)).toMatch(/message/i);
  });

  it("returns error when message is empty", async () => {
    const ctx = makeCtx();
    const result = await callTool(ctx, "mecha_query", { target: "bot-a", message: "" });
    expect(result.isError).toBe(true);
    expect(getText(result)).toMatch(/message/i);
  });

  it("returns error for invalid bot name", async () => {
    const ctx = makeCtx();
    const result = await callTool(ctx, "mecha_query", { target: "INVALID!", message: "hello" });
    expect(result.isError).toBe(true);
  });

  it("returns error for malformed address (@node, bot@, a@b@c)", async () => {
    const ctx = makeCtx();
    for (const bad of ["@node", "bot@", "a@b@c"]) {
      const result = await callTool(ctx, "mecha_query", { target: bad, message: "hello" });
      expect(result.isError).toBe(true);
    }
  });

  it("returns error for adversarial target strings", async () => {
    const ctx = makeCtx();
    for (const hostile of ["../etc/passwd", "bot%00name", "bot\nname", "+group"]) {
      const result = await callTool(ctx, "mecha_query", { target: hostile, message: "hello" });
      expect(result.isError).toBe(true);
    }
  });

  // --- Local bot ---

  it("returns error when local bot is not running", async () => {
    const ctx = makeCtx({
      pm: {
        get: vi.fn().mockReturnValue(undefined),
        list: vi.fn().mockReturnValue([]),
        getPortAndToken: vi.fn().mockReturnValue(undefined),
      } as never,
    });
    const result = await callTool(ctx, "mecha_query", { target: "bot-a", message: "hello" });
    expect(result.isError).toBe(true);
    expect(getText(result)).toMatch(/not running/i);
  });

  it("queries a local bot and returns response with sessionId", async () => {
    const ctx = makeLocalBotCtx();
    stubFetchJson({ response: "Hello from bot-a!", sessionId: "sess-1" });

    const result = await callTool(ctx, "mecha_query", { target: "bot-a", message: "hello" });
    expect(result.isError).toBeUndefined();
    expect(getText(result)).toContain("Hello from bot-a!");
    expect(getText(result)).toContain("sess-1");

    // Verify outbound request shape
    const fetchMock = vi.mocked(globalThis.fetch);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("127.0.0.1:7700"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"message":"hello"'),
      }),
    );
  });

  it("returns error when local forwarding fails", async () => {
    const ctx = makeLocalBotCtx();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const result = await callTool(ctx, "mecha_query", { target: "bot-a", message: "hello" });
    expect(result.isError).toBe(true);
    expect(getText(result)).toMatch(/failed/i);
  });

  // --- Remote bot ---

  it("queries a remote bot via agentFetch with source header", async () => {
    const mockAgentFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ response: "Remote reply", sessionId: "rsess-1" }),
    });
    const ctx = makeRemoteCtx(mockAgentFetch, {
      clientInfo: { name: "claude-code", version: "1.0" },
    });
    const result = await callTool(ctx, "mecha_query", {
      target: "bot-b@spark01",
      message: "hello remote",
    });
    expect(result.isError).toBeUndefined();
    expect(getText(result)).toContain("Remote reply");

    expect(mockAgentFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        node: expect.objectContaining({ name: "spark01" }),
        path: "/bots/bot-b/query",
        method: "POST",
        body: { message: "hello remote" },
        source: "mcp:claude-code",
      }),
    );
  });

  it("passes sessionId to remote node", async () => {
    const mockAgentFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ response: "continued", sessionId: "rsess-2" }),
    });
    const ctx = makeRemoteCtx(mockAgentFetch);
    const result = await callTool(ctx, "mecha_query", {
      target: "bot-b@spark01",
      message: "continue",
      sessionId: "rsess-1",
    });
    expect(result.isError).toBeUndefined();
    expect(mockAgentFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { message: "continue", sessionId: "rsess-1" },
      }),
    );
  });

  it("handles non-JSON remote response gracefully", async () => {
    const mockAgentFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "text/plain" }),
      text: async () => "plain text response",
    });
    const ctx = makeRemoteCtx(mockAgentFetch);
    const result = await callTool(ctx, "mecha_query", {
      target: "bot-b@spark01",
      message: "hello",
    });
    expect(result.isError).toBeUndefined();
    expect(getText(result)).toBe("plain text response");
  });

  it("returns error when remote node is not found", async () => {
    const ctx = makeCtx({ getNodes: vi.fn().mockReturnValue([]) });
    const result = await callTool(ctx, "mecha_query", {
      target: "bot-b@unknown",
      message: "hello",
    });
    expect(result.isError).toBe(true);
    expect(getText(result)).toMatch(/not found/i);
  });

  it("returns error when remote node returns non-ok status", async () => {
    const mockAgentFetch = vi.fn().mockResolvedValue({ ok: false, status: 502 });
    const ctx = makeRemoteCtx(mockAgentFetch);
    const result = await callTool(ctx, "mecha_query", {
      target: "bot-b@spark01",
      message: "hello",
    });
    expect(result.isError).toBe(true);
    expect(getText(result)).toMatch(/502/);
  });

  it("returns error for managed P2P nodes", async () => {
    const ctx = makeCtx({
      getNodes: vi.fn().mockReturnValue([
        { name: "peer01", host: "p2p", port: 0, apiKey: "", managed: true },
      ]),
    });
    const result = await callTool(ctx, "mecha_query", {
      target: "bot-b@peer01",
      message: "hello",
    });
    expect(result.isError).toBe(true);
    expect(getText(result)).toMatch(/managed|p2p/i);
  });

  it("handles agentFetch network errors gracefully", async () => {
    const mockAgentFetch = vi.fn().mockRejectedValue(new Error("Connection refused"));
    const ctx = makeRemoteCtx(mockAgentFetch);
    const result = await callTool(ctx, "mecha_query", {
      target: "bot-b@spark01",
      message: "hello",
    });
    expect(result.isError).toBe(true);
    expect(getText(result)).toMatch(/connection refused/i);
  });

  // --- Rate limiting & audit ---

  it("is rate-limited when limiter denies and skips downstream calls", async () => {
    const mockAgentFetch = vi.fn();
    const ctx = makeCtx({
      rateLimiter: { check: vi.fn().mockReturnValue(false), remaining: vi.fn().mockReturnValue(0) },
      pm: {
        get: vi.fn(),
        list: vi.fn().mockReturnValue([]),
        getPortAndToken: vi.fn(),
      } as never,
      agentFetch: mockAgentFetch as never,
    });
    const result = await callTool(ctx, "mecha_query", { target: "bot-a", message: "hello" });
    expect(result.isError).toBe(true);
    expect(getText(result)).toMatch(/rate limit/i);
    // Verify short-circuit: no downstream calls made
    expect(ctx.pm.getPortAndToken).not.toHaveBeenCalled();
    expect(mockAgentFetch).not.toHaveBeenCalled();
  });

  it("audits successful queries", async () => {
    const ctx = makeLocalBotCtx();
    stubFetchJson({ response: "ok" });
    await callTool(ctx, "mecha_query", { target: "bot-a", message: "hello" });
    expect(ctx.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "mecha_query", result: "ok" }),
    );
  });
});
