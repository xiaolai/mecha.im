import { describe, it, expect, afterEach } from "vitest";
import { createServer } from "../src/server.js";
import type { MechaId } from "@mecha/core";

const TEST_ID = "mx-test-abc123" as MechaId;
const TEST_TOKEN = "test-token-for-mcp";

const MCP_INIT_PAYLOAD = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "test-client", version: "1.0.0" },
  },
};

const AUTH_HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  authorization: `Bearer ${TEST_TOKEN}`,
};

describe("MCP HTTP transport", () => {
  let app: ReturnType<typeof createServer>;

  afterEach(async () => {
    if (app) await app.close();
  });

  it("POST /mcp with proper headers gets processed by transport", async () => {
    app = createServer({ mechaId: TEST_ID, authToken: TEST_TOKEN });

    const res = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: AUTH_HEADERS,
      payload: MCP_INIT_PAYLOAD,
    });

    expect(res.statusCode).toBe(200);
  });

  it("GET /mcp without session returns 400", async () => {
    app = createServer({ mechaId: TEST_ID, authToken: TEST_TOKEN });

    const res = await app.inject({
      method: "GET",
      url: "/mcp",
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toContain("session");
  });

  it("GET /mcp with invalid session returns 400", async () => {
    app = createServer({ mechaId: TEST_ID, authToken: TEST_TOKEN });

    const res = await app.inject({
      method: "GET",
      url: "/mcp",
      headers: {
        authorization: `Bearer ${TEST_TOKEN}`,
        "mcp-session-id": "nonexistent-session",
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it("DELETE /mcp without session returns 404", async () => {
    app = createServer({ mechaId: TEST_ID, authToken: TEST_TOKEN });

    const res = await app.inject({
      method: "DELETE",
      url: "/mcp",
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it("DELETE /mcp with invalid session returns 404", async () => {
    app = createServer({ mechaId: TEST_ID, authToken: TEST_TOKEN });

    const res = await app.inject({
      method: "DELETE",
      url: "/mcp",
      headers: {
        authorization: `Bearer ${TEST_TOKEN}`,
        "mcp-session-id": "nonexistent-session",
      },
    });

    expect(res.statusCode).toBe(404);
  });

  it("auth middleware rejects unauthenticated requests", async () => {
    app = createServer({ mechaId: TEST_ID, authToken: TEST_TOKEN });

    const res = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      payload: MCP_INIT_PAYLOAD,
    });

    expect(res.statusCode).toBe(401);
  });

  it("onClose hook cleans up without errors", async () => {
    app = createServer({ mechaId: TEST_ID, authToken: TEST_TOKEN });

    // Create a session via initialize
    await app.inject({
      method: "POST",
      url: "/mcp",
      headers: AUTH_HEADERS,
      payload: MCP_INIT_PAYLOAD,
    });

    // Close triggers onClose hook — clears intervals and sessions
    await app.close();
    // If no errors, cleanup succeeded
    app = undefined as any;
  });
});
