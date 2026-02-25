import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "../src/server.js";
import type { FastifyInstance } from "fastify";

describe("createServer", () => {
  let app: FastifyInstance;
  let tempDir: string;

  afterEach(async () => {
    if (app) await app.close();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  function setup() {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-server-test-"));
    const projectsDir = join(tempDir, "projects");
    const workspacePath = join(tempDir, "workspace");
    mkdirSync(workspacePath);
    writeFileSync(join(workspacePath, "README.md"), "# Test");

    const result = createServer({
      casaName: "test-casa",
      port: 7700,
      authToken: "test-token",
      projectsDir,
      workspacePath,
    });
    app = result.app;
    return app;
  }

  it("starts and serves /healthz without auth", async () => {
    const server = setup();
    await server.ready();

    const res = await server.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
  });

  it("rejects unauthenticated requests to /api/sessions", async () => {
    const server = setup();
    await server.ready();

    const res = await server.inject({ method: "GET", url: "/api/sessions" });
    expect(res.statusCode).toBe(401);
  });

  it("allows authenticated requests to /api/sessions", async () => {
    const server = setup();
    await server.ready();

    const res = await server.inject({
      method: "GET",
      url: "/api/sessions",
      headers: { authorization: "Bearer test-token" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("serves /info with CASA details", async () => {
    const server = setup();
    await server.ready();

    const res = await server.inject({
      method: "GET",
      url: "/info",
      headers: { authorization: "Bearer test-token" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe("test-casa");
    expect(body.port).toBe(7700);
  });

  it("serves MCP endpoint with auth", async () => {
    const server = setup();
    await server.ready();

    // Without auth
    const noAuth = await server.inject({
      method: "POST",
      url: "/mcp",
      payload: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    expect(noAuth.statusCode).toBe(401);

    // With auth
    const withAuth = await server.inject({
      method: "POST",
      url: "/mcp",
      payload: { jsonrpc: "2.0", id: 1, method: "tools/list" },
      headers: { authorization: "Bearer test-token" },
    });
    expect(withAuth.statusCode).toBe(200);
    expect(withAuth.json().result.tools).toHaveLength(2);
  });

  it("workspace tools can read files", async () => {
    const server = setup();
    await server.ready();

    const res = await server.inject({
      method: "POST",
      url: "/mcp",
      payload: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "mecha_workspace_read", arguments: { path: "README.md" } },
      },
      headers: { authorization: "Bearer test-token" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result.content[0].text).toBe("# Test");
  });

  it("session read works end-to-end", async () => {
    const server = setup();
    await server.ready();

    const headers = { authorization: "Bearer test-token" };

    // Write session files directly (simulating Claude Code)
    const projectsDir = join(tempDir, "projects");
    mkdirSync(projectsDir, { recursive: true });
    writeFileSync(
      join(projectsDir, "sess-1.meta.json"),
      JSON.stringify({ id: "sess-1", title: "E2E Test", starred: false, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }),
    );
    writeFileSync(
      join(projectsDir, "sess-1.jsonl"),
      '{"type":"user","content":"Hello"}\n',
    );

    // List
    const list = await server.inject({ method: "GET", url: "/api/sessions", headers });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(1);

    // Get
    const get = await server.inject({ method: "GET", url: "/api/sessions/sess-1", headers });
    expect(get.statusCode).toBe(200);
    expect(get.json().title).toBe("E2E Test");
    expect(get.json().events).toHaveLength(1);

    // 404 for unknown
    const notFound = await server.inject({ method: "GET", url: "/api/sessions/nope", headers });
    expect(notFound.statusCode).toBe(404);
  });
});
