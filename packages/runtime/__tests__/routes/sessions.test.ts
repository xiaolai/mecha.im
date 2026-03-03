import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type FastifyInstance } from "fastify";
import { createSessionManager } from "../../src/session-manager.js";
import { registerSessionRoutes } from "../../src/routes/sessions.js";

describe("session routes (read-only)", () => {
  let app: FastifyInstance;
  let tempDir: string;
  let projectsDir: string;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-routes-test-"));
    projectsDir = join(tempDir, "projects");
    mkdirSync(projectsDir, { recursive: true });

    const sm = createSessionManager(projectsDir);
    app = Fastify();
    registerSessionRoutes(app, sm);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("GET /api/sessions", () => {
    it("returns empty list", async () => {
      const res = await app.inject({ method: "GET", url: "/api/sessions" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it("returns sessions from filesystem", async () => {
      writeFileSync(
        join(projectsDir, "abc.meta.json"),
        JSON.stringify({ id: "abc", title: "Test", starred: false, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }),
      );
      const res = await app.inject({ method: "GET", url: "/api/sessions" });
      expect(res.statusCode).toBe(200);
      const sessions = res.json();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].title).toBe("Test");
    });
  });

  describe("GET /api/sessions/:id", () => {
    it("returns session with transcript events", async () => {
      writeFileSync(
        join(projectsDir, "sess-1.meta.json"),
        JSON.stringify({ id: "sess-1", title: "Research", starred: false, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }),
      );
      writeFileSync(
        join(projectsDir, "sess-1.jsonl"),
        '{"type":"user","content":"Hello"}\n{"type":"assistant","content":"Hi"}\n',
      );

      const res = await app.inject({ method: "GET", url: "/api/sessions/sess-1" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.title).toBe("Research");
      expect(body.events).toHaveLength(2);
    });

    it("returns 404 for unknown session", async () => {
      const res = await app.inject({ method: "GET", url: "/api/sessions/nonexistent" });
      expect(res.statusCode).toBe(404);
    });

    it("returns 404 for path traversal attempt with ../", async () => {
      const res = await app.inject({ method: "GET", url: "/api/sessions/..%2F..%2Fetc%2Fpasswd" });
      expect(res.statusCode).toBe(404);
    });

    it("returns 404 for ID with path separators", async () => {
      const res = await app.inject({ method: "GET", url: "/api/sessions/foo%2Fbar" });
      expect(res.statusCode).toBe(404);
    });

    it("returns 404 for very long ID", async () => {
      const longId = "a".repeat(1000);
      const res = await app.inject({ method: "GET", url: `/api/sessions/${longId}` });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("DELETE /api/sessions/:id", () => {
    it("deletes an existing session", async () => {
      writeFileSync(
        join(projectsDir, "doomed.meta.json"),
        JSON.stringify({ id: "doomed", title: "Doomed", starred: false, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }),
      );
      writeFileSync(join(projectsDir, "doomed.jsonl"), '{"type":"user","content":"bye"}\n');

      const res = await app.inject({ method: "DELETE", url: "/api/sessions/doomed" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });

      // Verify it's actually gone
      const listRes = await app.inject({ method: "GET", url: "/api/sessions" });
      expect(listRes.json()).toEqual([]);
    });

    it("returns 404 for nonexistent session", async () => {
      const res = await app.inject({ method: "DELETE", url: "/api/sessions/nonexistent" });
      expect(res.statusCode).toBe(404);
    });

    it("returns 404 for invalid ID (path traversal)", async () => {
      const res = await app.inject({ method: "DELETE", url: "/api/sessions/..%2F..%2Fetc%2Fpasswd" });
      expect(res.statusCode).toBe(404);
    });
  });
});
