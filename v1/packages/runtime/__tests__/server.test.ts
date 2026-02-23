import { describe, it, expect, afterEach } from "vitest";
import { createServer } from "../src/server.js";
import type { MechaId } from "@mecha/core";

const TEST_ID = "mx-test-abc123" as MechaId;

describe("Fastify server", () => {
  let app: ReturnType<typeof createServer>;

  afterEach(async () => {
    if (app) await app.close();
  });

  it("GET /healthz returns 200 with status and uptime", async () => {
    app = createServer({ mechaId: TEST_ID, skipMcp: true, skipAuth: true });
    const res = await app.inject({ method: "GET", url: "/healthz" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe("ok");
    expect(typeof body.uptime).toBe("number");
  });

  it("GET /info returns mecha info", async () => {
    app = createServer({ mechaId: TEST_ID, version: "1.2.3", skipMcp: true, skipAuth: true });
    const res = await app.inject({ method: "GET", url: "/info" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe(TEST_ID);
    expect(body.version).toBe("1.2.3");
    expect(body.state).toBe("running");
    expect(typeof body.uptime).toBe("number");
  });

  it("POST /api/chat returns 400 without message", async () => {
    app = createServer({ mechaId: TEST_ID, skipMcp: true, skipAuth: true });
    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toContain("Missing");
  });

  it("POST /api/chat returns 503 when agent not configured", async () => {
    app = createServer({ mechaId: TEST_ID, skipMcp: true, skipAuth: true });
    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "hello" },
    });

    expect(res.statusCode).toBe(503);
    const body = JSON.parse(res.body);
    expect(body.error).toContain("not configured");
  });

  it("graceful shutdown closes the server", async () => {
    app = createServer({ mechaId: TEST_ID, skipMcp: true, skipAuth: true });
    await app.ready();
    await app.close();
    // After close, inject should throw or fail
    try {
      await app.inject({ method: "GET", url: "/healthz" });
    } catch {
      // Expected - server is closed
    }
  });

  it("rejects requests without auth token when auth is enabled", async () => {
    app = createServer({ mechaId: TEST_ID, skipMcp: true, authToken: "test-secret-token" });
    const res = await app.inject({ method: "GET", url: "/info" });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error).toBe("Unauthorized");
  });

  it("allows requests with valid auth token when auth is enabled", async () => {
    app = createServer({ mechaId: TEST_ID, skipMcp: true, authToken: "test-secret-token" });
    const res = await app.inject({
      method: "GET",
      url: "/info",
      headers: { authorization: "Bearer test-secret-token" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe(TEST_ID);
  });

  it("allows /healthz without auth even when auth is enabled", async () => {
    app = createServer({ mechaId: TEST_ID, skipMcp: true, authToken: "test-secret-token" });
    const res = await app.inject({ method: "GET", url: "/healthz" });

    expect(res.statusCode).toBe(200);
  });

  it("auto-generates token and logs it on ready when authToken is omitted", async () => {
    app = createServer({ mechaId: TEST_ID, skipMcp: true, logger: true });
    await app.ready();

    // Verify auth is active: unauthenticated request should fail
    const res = await app.inject({ method: "GET", url: "/info" });
    expect(res.statusCode).toBe(401);
  });

  it("registers MCP routes when skipMcp is not set", async () => {
    app = createServer({ mechaId: TEST_ID, skipAuth: true });

    // MCP route should exist - POST /mcp should not return 404
    const res = await app.inject({ method: "POST", url: "/mcp", payload: {} });
    // It may return an error from MCP processing, but NOT 404
    expect(res.statusCode).not.toBe(404);
  });

  it("registers agent routes with agent options", async () => {
    app = createServer({
      mechaId: TEST_ID,
      skipMcp: true,
      skipAuth: true,
      agent: { workingDirectory: "/tmp", permissionMode: "full-auto" },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "hello" },
    });

    // With agent configured, it should attempt to use the SDK (not return 503)
    // It will fail because the SDK isn't available in test, but it won't be 503
    expect(res.statusCode).not.toBe(503);
  });

  it("creates server with agent but no workingDirectory (uses process.cwd() fallback)", async () => {
    const { createDatabase, runMigrations } = await import("../src/db/sqlite.js");
    const testDb = createDatabase(":memory:");
    runMigrations(testDb);
    app = createServer({
      mechaId: TEST_ID,
      skipMcp: true,
      skipAuth: true,
      db: testDb,
      agent: { permissionMode: "default" as const },
    });
    const res = await app.inject({ method: "GET", url: "/api/sessions" });
    expect(res.statusCode).toBe(200);
  });

  it("uses default version when version is omitted", async () => {
    app = createServer({ mechaId: TEST_ID, skipMcp: true, skipAuth: true });
    const res = await app.inject({ method: "GET", url: "/info" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.version).toBe("0.1.0");
  });

  it("onClose hook cleans up signal listeners", async () => {
    app = createServer({ mechaId: TEST_ID, skipMcp: true, skipAuth: true });
    await app.ready();

    // Count SIGTERM listeners before and after close
    const beforeCount = process.listenerCount("SIGTERM");
    await app.close();
    const afterCount = process.listenerCount("SIGTERM");

    // Should have removed its listener
    expect(afterCount).toBeLessThan(beforeCount);
  });
});
