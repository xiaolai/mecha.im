import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "../src/server.js";
import { createDatabase, runMigrations } from "../src/db/sqlite.js";
import { SessionManager, resolveProjectDir } from "../src/agent/session-manager.js";
import { registerSessionRoutes } from "../src/agent/session-routes.js";
import Fastify from "fastify";
import type { MechaId } from "@mecha/core";
import type Database from "better-sqlite3";

// Mock the Claude Agent SDK so sendMessage does not hit a real SDK
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(() =>
    (async function* () {
      yield {
        type: "assistant",
        message: { content: [{ type: "text", text: "mock response" }] },
        session_id: "sdk-mock-session",
      };
    })(),
  ),
}));

const TEST_ID = "mx-test-routes" as MechaId;

function createTestApp(opts?: { withAgent?: boolean; withDb?: boolean }) {
  const withAgent = opts?.withAgent ?? true;
  const withDb = opts?.withDb ?? true;

  const db = withDb ? createDatabase(":memory:") : undefined;
  if (db) runMigrations(db);

  const app = createServer({
    mechaId: TEST_ID,
    skipMcp: true,
    skipAuth: true,
    db,
    ...(withAgent
      ? { agent: { workingDirectory: "/tmp", permissionMode: "default" as const } }
      : {}),
  });

  return { app, db };
}

describe("Session routes", () => {
  let app: ReturnType<typeof createServer>;
  let db: Database.Database | undefined;

  afterEach(async () => {
    if (app) await app.close();
    if (db) db.close();
  });

  // --- POST /api/sessions ---

  it("POST /api/sessions returns 201 with session data including usage", async () => {
    ({ app, db } = createTestApp());
    const res = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { title: "Test Session" },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.sessionId).toBeDefined();
    expect(body.state).toBe("idle");
    expect(body.title).toBe("Test Session");
    expect(body.usage).toEqual({
      totalCostUsd: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalDurationMs: 0,
      turnCount: 0,
    });
  });

  it("POST /api/sessions without agent config returns 503", async () => {
    ({ app, db } = createTestApp({ withAgent: false, withDb: false }));
    const res = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: {},
    });

    expect(res.statusCode).toBe(503);
    const body = JSON.parse(res.body);
    expect(body.error).toContain("not available");
  });

  it("POST /api/sessions at cap returns 429", async () => {
    ({ app, db } = createTestApp());
    // Fill up to MAX_SESSIONS (50)
    for (let i = 0; i < 50; i++) {
      db!.prepare(
        "INSERT INTO sessions (id, title, config) VALUES (?, '', '{}')",
      ).run(`cap-session-${i}`);
    }

    const res = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: {},
    });

    expect(res.statusCode).toBe(429);
    const body = JSON.parse(res.body);
    expect(body.error).toContain("Maximum");
  });

  // --- GET /api/sessions ---

  it("GET /api/sessions returns array with usage", async () => {
    ({ app, db } = createTestApp());
    // Create a session via the API
    await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { title: "Listed" },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/sessions",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body[0].title).toBe("Listed");
    expect(body[0].usage).toBeDefined();
    expect(body[0].usage.turnCount).toBe(0);
  });

  // --- GET /api/sessions/:id ---

  it("GET /api/sessions/:id returns session with messages and usage", async () => {
    ({ app, db } = createTestApp());
    const createRes = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { title: "Detail" },
    });
    const { sessionId } = JSON.parse(createRes.body);

    // Insert a message directly for test
    db!.prepare(
      "INSERT INTO session_messages (session_id, role, content) VALUES (?, 'user', 'test msg')",
    ).run(sessionId);

    const res = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.sessionId).toBe(sessionId);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe("user");
    expect(body.messages[0].content).toBe("test msg");
    expect(body.usage).toBeDefined();
    expect(body.usage.totalCostUsd).toBe(0);
  });

  it("GET /api/sessions/:id bad id returns 404", async () => {
    ({ app, db } = createTestApp());
    const res = await app.inject({
      method: "GET",
      url: "/api/sessions/nonexistent-id",
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error).toContain("not found");
  });

  it("GET /api/sessions/:id with limit/offset pagination", async () => {
    ({ app, db } = createTestApp());
    const createRes = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: {},
    });
    const { sessionId } = JSON.parse(createRes.body);

    // Insert multiple messages
    for (let i = 0; i < 5; i++) {
      db!.prepare(
        "INSERT INTO session_messages (session_id, role, content) VALUES (?, 'user', ?)",
      ).run(sessionId, `message-${i}`);
    }

    const res = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}?limit=2&offset=1`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].content).toBe("message-1");
    expect(body.messages[1].content).toBe("message-2");
    expect(body.totalMessages).toBe(5);
  });

  // --- DELETE /api/sessions/:id ---

  it("DELETE /api/sessions/:id returns 204", async () => {
    ({ app, db } = createTestApp());
    const createRes = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: {},
    });
    const { sessionId } = JSON.parse(createRes.body);

    const res = await app.inject({
      method: "DELETE",
      url: `/api/sessions/${sessionId}`,
    });

    expect(res.statusCode).toBe(204);

    // Confirm deleted
    const getRes = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}`,
    });
    expect(getRes.statusCode).toBe(404);
  });

  it("DELETE /api/sessions/:id bad id returns 404", async () => {
    ({ app, db } = createTestApp());
    const res = await app.inject({
      method: "DELETE",
      url: "/api/sessions/nonexistent-id",
    });

    expect(res.statusCode).toBe(404);
  });

  // --- PATCH /api/sessions/:id ---

  it("PATCH /api/sessions/:id renames session", async () => {
    ({ app, db } = createTestApp());
    const createRes = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { title: "Original" },
    });
    const { sessionId } = JSON.parse(createRes.body);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/sessions/${sessionId}`,
      payload: { title: "Renamed" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.title).toBe("Renamed");
    expect(body.sessionId).toBe(sessionId);
  });

  it("PATCH /api/sessions/:id missing title returns 400", async () => {
    ({ app, db } = createTestApp());
    const createRes = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: {},
    });
    const { sessionId } = JSON.parse(createRes.body);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/sessions/${sessionId}`,
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain("title");
  });

  it("PATCH /api/sessions/:id nonexistent returns 404", async () => {
    ({ app, db } = createTestApp());
    const res = await app.inject({
      method: "PATCH",
      url: "/api/sessions/nonexistent-id",
      payload: { title: "New" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("PATCH /api/sessions/:id returns 503 when no agent configured", async () => {
    ({ app, db } = createTestApp({ withAgent: false, withDb: false }));
    const res = await app.inject({
      method: "PATCH",
      url: "/api/sessions/some-id",
      payload: { title: "New" },
    });

    expect(res.statusCode).toBe(503);
  });

  // --- POST /api/sessions/:id/message ---

  it("POST /api/sessions/:id/message missing message returns 400", async () => {
    ({ app, db } = createTestApp());
    const createRes = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: {},
    });
    const { sessionId } = JSON.parse(createRes.body);

    const res = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/message`,
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toContain("Missing");
  });

  it("POST /api/sessions/:id/message bad id returns 404", async () => {
    ({ app, db } = createTestApp());
    const res = await app.inject({
      method: "POST",
      url: "/api/sessions/nonexistent-id/message",
      payload: { message: "hello" },
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error).toContain("not found");
  });

  // --- POST /api/sessions/:id/interrupt ---

  it("POST /api/sessions/:id/interrupt returns 200", async () => {
    ({ app, db } = createTestApp());
    const createRes = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: {},
    });
    const { sessionId } = JSON.parse(createRes.body);

    const res = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/interrupt`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.interrupted).toBe(false); // idle session, nothing to interrupt
  });

  it("POST /api/sessions/:id/interrupt nonexistent returns 404", async () => {
    ({ app, db } = createTestApp());
    const res = await app.inject({
      method: "POST",
      url: "/api/sessions/nonexistent-id/interrupt",
    });

    expect(res.statusCode).toBe(404);
  });

  // --- PUT /api/sessions/:id/config ---

  it("PUT /api/sessions/:id/config returns 200 with updated config", async () => {
    ({ app, db } = createTestApp());
    const createRes = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: {},
    });
    const { sessionId } = JSON.parse(createRes.body);

    const res = await app.inject({
      method: "PUT",
      url: `/api/sessions/${sessionId}/config`,
      payload: { maxTurns: 20, model: "claude-sonnet-4-20250514" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.sessionId).toBe(sessionId);
    expect(body.config.maxTurns).toBe(20);
    expect(body.config.model).toBe("claude-sonnet-4-20250514");
  });

  it("PUT /api/sessions/:id/config with invalid config returns 400", async () => {
    ({ app, db } = createTestApp());
    const createRes = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: {},
    });
    const { sessionId } = JSON.parse(createRes.body);

    const res = await app.inject({
      method: "PUT",
      url: `/api/sessions/${sessionId}/config`,
      payload: { maxTurns: -5 }, // negative is invalid (must be positive)
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toContain("Invalid config");
  });

  it("PUT /api/sessions/:id/config nonexistent session returns 404", async () => {
    ({ app, db } = createTestApp());
    const res = await app.inject({
      method: "PUT",
      url: "/api/sessions/nonexistent-id/config",
      payload: { maxTurns: 10 },
    });

    expect(res.statusCode).toBe(404);
  });

  it("POST /api/sessions with null body defaults to empty object", async () => {
    ({ app, db } = createTestApp());
    const res = await app.inject({
      method: "POST",
      url: "/api/sessions",
    });

    expect(res.statusCode).toBe(201);
  });

  it("GET /api/sessions/:id with NaN limit/offset uses defaults", async () => {
    ({ app, db } = createTestApp());
    const createRes = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: {},
    });
    const { sessionId } = JSON.parse(createRes.body);

    const res = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}?limit=abc&offset=xyz`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.sessionId).toBe(sessionId);
  });

  it("GET /api/sessions/:id with no query params uses defaults", async () => {
    ({ app, db } = createTestApp());
    const createRes = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: {},
    });
    const { sessionId } = JSON.parse(createRes.body);

    const res = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}`,
    });

    expect(res.statusCode).toBe(200);
  });

  it("GET /api/sessions/:id with very large limit is capped at 200", async () => {
    ({ app, db } = createTestApp());
    const createRes = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: {},
    });
    const { sessionId } = JSON.parse(createRes.body);

    const res = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}?limit=9999`,
    });

    expect(res.statusCode).toBe(200);
  });

  // --- Additional coverage: POST /api/sessions with invalid config ---

  it("POST /api/sessions with valid config stores config", async () => {
    ({ app, db } = createTestApp());
    const res = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { title: "Configured", config: { maxTurns: 10 } },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.title).toBe("Configured");
  });

  it("POST /api/sessions with invalid config returns 400", async () => {
    ({ app, db } = createTestApp());
    const res = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { config: { maxTurns: -1 } },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toContain("Invalid config");
  });

  // --- Additional coverage: POST /api/sessions/:id/message streaming ---

  it("POST /api/sessions/:id/message streams SSE response", async () => {
    ({ app, db } = createTestApp());
    const createRes = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: {},
    });
    const { sessionId } = JSON.parse(createRes.body);

    const res = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/message`,
      payload: { message: "hello" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream");
    expect(res.body).toContain("data: ");
    expect(res.body).toContain("[DONE]");
    // Should contain the session event
    expect(res.body).toContain(`"session_id":"${sessionId}"`);
  });

  it("POST /api/sessions/:id/message with empty stream still sends DONE", async () => {
    ({ app, db } = createTestApp());
    // Need to mock query to return empty stream
    const { query: mockQuery } = await import("@anthropic-ai/claude-agent-sdk");
    const original = vi.mocked(mockQuery);
    original.mockReturnValueOnce(
      (async function* () {
        // yield nothing — empty stream
      })() as any,
    );

    const createRes = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: {},
    });
    const { sessionId } = JSON.parse(createRes.body);

    const res = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/message`,
      payload: { message: "hello" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("[DONE]");
  });

  it("POST /api/sessions/:id/message on busy session returns 409", async () => {
    ({ app, db } = createTestApp());
    const createRes = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: {},
    });
    const { sessionId } = JSON.parse(createRes.body);

    // Mark session as busy
    db!.prepare("UPDATE sessions SET state = 'busy' WHERE id = ?").run(sessionId);

    const res = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/message`,
      payload: { message: "hello" },
    });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.error).toContain("busy");
  });

  it("POST /api/sessions/:id/message with too long message returns 400", async () => {
    ({ app, db } = createTestApp());
    const createRes = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: {},
    });
    const { sessionId } = JSON.parse(createRes.body);

    const res = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/message`,
      payload: { message: "x".repeat(100_001) },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain("too long");
  });

  it("POST /api/sessions/:id/message with non-string message returns 400", async () => {
    ({ app, db } = createTestApp());
    const createRes = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: {},
    });
    const { sessionId } = JSON.parse(createRes.body);

    const res = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/message`,
      payload: { message: 123 },
    });

    expect(res.statusCode).toBe(400);
  });

  // --- Additional coverage: PUT /api/sessions/:id/config on busy ---

  it("PUT /api/sessions/:id/config on busy session returns 409", async () => {
    ({ app, db } = createTestApp());
    const createRes = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: {},
    });
    const { sessionId } = JSON.parse(createRes.body);

    db!.prepare("UPDATE sessions SET state = 'busy' WHERE id = ?").run(sessionId);

    const res = await app.inject({
      method: "PUT",
      url: `/api/sessions/${sessionId}/config`,
      payload: { maxTurns: 10 },
    });

    expect(res.statusCode).toBe(409);
  });

  // --- All 503 unavailable routes ---

  it("all session routes return 503 when no agent/db configured", async () => {
    ({ app, db } = createTestApp({ withAgent: false, withDb: false }));

    const routes = [
      { method: "GET" as const, url: "/api/sessions" },
      { method: "GET" as const, url: "/api/sessions/some-id" },
      { method: "DELETE" as const, url: "/api/sessions/some-id" },
      { method: "PATCH" as const, url: "/api/sessions/some-id", payload: { title: "New" } },
      { method: "POST" as const, url: "/api/sessions/some-id/message", payload: { message: "hi" } },
      { method: "POST" as const, url: "/api/sessions/some-id/interrupt" },
      { method: "PUT" as const, url: "/api/sessions/some-id/config", payload: { maxTurns: 5 } },
      { method: "POST" as const, url: "/api/sessions/import" },
    ];

    for (const route of routes) {
      const res = await app.inject(route);
      expect(res.statusCode).toBe(503);
    }
  });

  // --- POST /api/sessions/import ---

  it("POST /api/sessions/import imports JSONL transcripts", async () => {
    const tmpBase = mkdtempSync(join(tmpdir(), "mecha-route-test-"));
    const projectDir = resolveProjectDir(tmpBase);
    mkdirSync(projectDir, { recursive: true });

    writeFileSync(join(projectDir, "sdk-route-test.jsonl"), [
      JSON.stringify({ type: "user", message: { content: "route test" }, timestamp: "2024-06-01T10:00:00Z" }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "reply" }] }, timestamp: "2024-06-01T10:00:05Z" }),
    ].join("\n"));

    const testDb = createDatabase(":memory:");
    runMigrations(testDb);
    app = createServer({
      mechaId: TEST_ID,
      skipMcp: true,
      skipAuth: true,
      db: testDb,
      agent: { workingDirectory: tmpBase, permissionMode: "default" as const },
    });
    db = testDb;

    // The startup import should have already imported it
    const listRes = await app.inject({ method: "GET", url: "/api/sessions" });
    const sessions = JSON.parse(listRes.body);
    expect(sessions.length).toBeGreaterThanOrEqual(1);

    // Calling import again should return 0 (idempotent)
    const res = await app.inject({
      method: "POST",
      url: "/api/sessions/import",
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).imported).toBe(0);
  });

  it("POST /api/sessions/import returns imported count for new files", async () => {
    const tmpBase = mkdtempSync(join(tmpdir(), "mecha-route-test2-"));

    const testDb = createDatabase(":memory:");
    runMigrations(testDb);
    app = createServer({
      mechaId: TEST_ID,
      skipMcp: true,
      skipAuth: true,
      db: testDb,
      agent: { workingDirectory: tmpBase, permissionMode: "default" as const },
    });
    db = testDb;

    // Now create the project dir and add a transcript after server startup
    const projectDir = resolveProjectDir(tmpBase);
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, "sdk-new.jsonl"), [
      JSON.stringify({ type: "user", message: { content: "new transcript" }, timestamp: "2024-06-01T10:00:00Z" }),
    ].join("\n"));

    const res = await app.inject({
      method: "POST",
      url: "/api/sessions/import",
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).imported).toBe(1);
  });

  it("POST /api/sessions/import returns 400 when no projectDir configured", async () => {
    const testDb = createDatabase(":memory:");
    runMigrations(testDb);
    const sm = new SessionManager(testDb, { mechaId: TEST_ID, workingDirectory: "/tmp" });
    const directApp = Fastify();
    // Register with sessionManager but no projectDir
    registerSessionRoutes(directApp, sm);

    const res = await directApp.inject({
      method: "POST",
      url: "/api/sessions/import",
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain("No project directory");
    await directApp.close();
    testDb.close();
  });
});
