import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/database.js";
import { createSessionManager } from "../../src/session-manager.js";
import { registerSessionRoutes } from "../../src/routes/sessions.js";
import type { SessionManager } from "../../src/session-manager.js";

describe("session routes", () => {
  let app: FastifyInstance;
  let db: InstanceType<typeof Database>;
  let sm: SessionManager;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-routes-test-"));
    db = new Database(":memory:");
    runMigrations(db);
    sm = createSessionManager(db, join(tempDir, "transcripts"));

    app = Fastify();
    registerSessionRoutes(app, sm);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("GET /api/sessions", () => {
    it("returns empty list", async () => {
      const res = await app.inject({ method: "GET", url: "/api/sessions" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it("returns created sessions", async () => {
      sm.create({ title: "Test" });
      const res = await app.inject({ method: "GET", url: "/api/sessions" });
      expect(res.statusCode).toBe(200);
      const sessions = res.json();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].title).toBe("Test");
    });
  });

  describe("POST /api/sessions", () => {
    it("creates a session with title", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/sessions",
        payload: { title: "New Session" },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.title).toBe("New Session");
      expect(body.id).toBeDefined();
    });

    it("creates a session without body", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/sessions",
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().title).toBe("");
    });
  });

  describe("GET /api/sessions/:id", () => {
    it("returns session with messages", async () => {
      const session = sm.create({ title: "Test" });
      await sm.appendMessage(session.id, {
        role: "user",
        content: "Hi",
        timestamp: "2026-01-01T00:00:00Z",
      });

      const res = await app.inject({
        method: "GET",
        url: `/api/sessions/${session.id}`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.title).toBe("Test");
      expect(body.messages).toHaveLength(1);
    });

    it("returns 404 for unknown session", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/sessions/nonexistent",
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("DELETE /api/sessions/:id", () => {
    it("deletes a session", async () => {
      const session = sm.create();
      const res = await app.inject({
        method: "DELETE",
        url: `/api/sessions/${session.id}`,
      });
      expect(res.statusCode).toBe(204);
      expect(await sm.get(session.id)).toBeUndefined();
    });

    it("returns 404 for unknown session", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: "/api/sessions/nonexistent",
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("PATCH /api/sessions/:id", () => {
    it("renames a session", async () => {
      const session = sm.create({ title: "Old" });
      const res = await app.inject({
        method: "PATCH",
        url: `/api/sessions/${session.id}`,
        payload: { title: "New" },
      });
      expect(res.statusCode).toBe(200);
      expect((await sm.get(session.id))!.title).toBe("New");
    });

    it("returns 404 for unknown session", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/sessions/nonexistent",
        payload: { title: "X" },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("PUT /api/sessions/:id/star", () => {
    it("stars a session", async () => {
      const session = sm.create();
      const res = await app.inject({
        method: "PUT",
        url: `/api/sessions/${session.id}/star`,
        payload: { starred: true },
      });
      expect(res.statusCode).toBe(200);
      expect((await sm.get(session.id))!.starred).toBe(true);
    });

    it("returns 404 for unknown session", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/sessions/nonexistent/star",
        payload: { starred: true },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("POST /api/sessions/:id/message", () => {
    it("appends a message", async () => {
      const session = sm.create();
      const res = await app.inject({
        method: "POST",
        url: `/api/sessions/${session.id}/message`,
        payload: { role: "user", content: "Hello" },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.role).toBe("user");
      expect(body.content).toBe("Hello");
      expect(body.timestamp).toBeDefined();
    });

    it("returns 404 for unknown session", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/sessions/nonexistent/message",
        payload: { role: "user", content: "Hello" },
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 409 when session is busy", async () => {
      const session = sm.create();
      sm.setBusy(session.id, true);
      const res = await app.inject({
        method: "POST",
        url: `/api/sessions/${session.id}/message`,
        payload: { role: "user", content: "Hello" },
      });
      expect(res.statusCode).toBe(409);
    });
  });

  describe("POST /api/sessions/:id/interrupt", () => {
    it("interrupts a busy session", async () => {
      const session = sm.create();
      sm.setBusy(session.id, true);
      const res = await app.inject({
        method: "POST",
        url: `/api/sessions/${session.id}/interrupt`,
      });
      expect(res.statusCode).toBe(200);
      expect(sm.isBusy(session.id)).toBe(false);
    });

    it("returns 409 when session is not busy", async () => {
      const session = sm.create();
      const res = await app.inject({
        method: "POST",
        url: `/api/sessions/${session.id}/interrupt`,
      });
      expect(res.statusCode).toBe(409);
    });
  });
});
