import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "../src/server.js";
import type { FastifyInstance } from "fastify";

describe("schedule routes", () => {
  let app: FastifyInstance;
  let tempDir: string;
  const headers = { authorization: "Bearer test-token" };

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-schedule-routes-"));
    const projectsDir = join(tempDir, "projects");
    const workspacePath = join(tempDir, "workspace");
    const botDir = join(tempDir, "bot");
    mkdirSync(workspacePath);
    mkdirSync(botDir);

    const result = createServer({
      botName: "test-bot",
      port: 7700,
      authToken: "test-token",
      projectsDir,
      workspacePath,
      botDir,
      chatFn: async () => ({ durationMs: 50 }),
    });
    app = result.app;
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("GET /api/schedules returns empty list", async () => {
    const res = await app.inject({ method: "GET", url: "/api/schedules", headers });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("POST /api/schedules adds a schedule", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/schedules",
      headers,
      payload: { id: "test-sched", every: "5m", prompt: "Hello world" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().ok).toBe(true);

    // Verify it's listed
    const list = await app.inject({ method: "GET", url: "/api/schedules", headers });
    expect(list.json()).toHaveLength(1);
    expect(list.json()[0].id).toBe("test-sched");
  });

  it("POST /api/schedules rejects invalid interval", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/schedules",
      headers,
      payload: { id: "bad", every: "2s", prompt: "test" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("Invalid interval");
  });

  it("POST /api/schedules rejects duplicate", async () => {
    const payload = { id: "dup", every: "1m", prompt: "test" };
    await app.inject({ method: "POST", url: "/api/schedules", headers, payload });
    const res = await app.inject({ method: "POST", url: "/api/schedules", headers, payload });
    expect(res.statusCode).toBe(409);
  });

  it("POST /api/schedules rejects invalid body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/schedules",
      headers,
      payload: { id: "x" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("DELETE /api/schedules/:id removes schedule", async () => {
    await app.inject({
      method: "POST", url: "/api/schedules", headers,
      payload: { id: "del-me", every: "5m", prompt: "test" },
    });
    const del = await app.inject({ method: "DELETE", url: "/api/schedules/del-me", headers });
    expect(del.statusCode).toBe(204);

    const list = await app.inject({ method: "GET", url: "/api/schedules", headers });
    expect(list.json()).toHaveLength(0);
  });

  it("DELETE /api/schedules/:id returns 404 for unknown", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api/schedules/nope", headers });
    expect(res.statusCode).toBe(404);
  });

  it("POST /api/schedules/:id/pause pauses schedule", async () => {
    await app.inject({
      method: "POST", url: "/api/schedules", headers,
      payload: { id: "pause-me", every: "5m", prompt: "test" },
    });
    const res = await app.inject({ method: "POST", url: "/api/schedules/pause-me/pause", headers });
    expect(res.statusCode).toBe(200);

    const list = await app.inject({ method: "GET", url: "/api/schedules", headers });
    expect(list.json()[0].paused).toBe(true);
  });

  it("POST /api/schedules/:id/resume resumes schedule", async () => {
    await app.inject({
      method: "POST", url: "/api/schedules", headers,
      payload: { id: "resume-me", every: "5m", prompt: "test" },
    });
    await app.inject({ method: "POST", url: "/api/schedules/resume-me/pause", headers });
    const res = await app.inject({ method: "POST", url: "/api/schedules/resume-me/resume", headers });
    expect(res.statusCode).toBe(200);

    const list = await app.inject({ method: "GET", url: "/api/schedules", headers });
    expect(list.json()[0].paused).toBe(false);
  });

  it("POST /api/schedules/:id/pause returns 404 for unknown", async () => {
    const res = await app.inject({ method: "POST", url: "/api/schedules/nope/pause", headers });
    expect(res.statusCode).toBe(404);
  });

  it("POST /api/schedules/:id/resume returns 404 for unknown", async () => {
    const res = await app.inject({ method: "POST", url: "/api/schedules/nope/resume", headers });
    expect(res.statusCode).toBe(404);
  });

  it("POST /api/schedules/:id/run returns 404 for unknown", async () => {
    const res = await app.inject({ method: "POST", url: "/api/schedules/nope/run", headers });
    expect(res.statusCode).toBe(404);
  });

  it("POST /api/schedules/_pause-all pauses all", async () => {
    await app.inject({
      method: "POST", url: "/api/schedules", headers,
      payload: { id: "a", every: "5m", prompt: "test" },
    });
    await app.inject({
      method: "POST", url: "/api/schedules", headers,
      payload: { id: "b", every: "10m", prompt: "test" },
    });
    const res = await app.inject({ method: "POST", url: "/api/schedules/_pause-all", headers });
    expect(res.statusCode).toBe(200);

    const list = await app.inject({ method: "GET", url: "/api/schedules", headers });
    expect(list.json().every((s: { paused?: boolean }) => s.paused)).toBe(true);
  });

  it("POST /api/schedules/_resume-all resumes all", async () => {
    await app.inject({
      method: "POST", url: "/api/schedules", headers,
      payload: { id: "c", every: "5m", prompt: "test" },
    });
    await app.inject({ method: "POST", url: "/api/schedules/_pause-all", headers });
    const res = await app.inject({ method: "POST", url: "/api/schedules/_resume-all", headers });
    expect(res.statusCode).toBe(200);

    const list = await app.inject({ method: "GET", url: "/api/schedules", headers });
    expect(list.json().every((s: { paused?: boolean }) => !s.paused)).toBe(true);
  });

  it("GET /api/schedules/:id/history without limit returns all", async () => {
    await app.inject({
      method: "POST", url: "/api/schedules", headers,
      payload: { id: "hist-no-limit", every: "5m", prompt: "test" },
    });
    await app.inject({ method: "POST", url: "/api/schedules/hist-no-limit/run", headers });
    const res = await app.inject({ method: "GET", url: "/api/schedules/hist-no-limit/history", headers });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });

  it("POST /api/schedules/:id/run triggers immediate run", async () => {
    await app.inject({
      method: "POST", url: "/api/schedules", headers,
      payload: { id: "run-me", every: "5m", prompt: "do something" },
    });
    const res = await app.inject({ method: "POST", url: "/api/schedules/run-me/run", headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().outcome).toBe("success");
    expect(res.json().durationMs).toBe(50);
  });

  it("GET /api/schedules/:id/history returns run history", async () => {
    await app.inject({
      method: "POST", url: "/api/schedules", headers,
      payload: { id: "hist", every: "5m", prompt: "test" },
    });
    await app.inject({ method: "POST", url: "/api/schedules/hist/run", headers });
    await app.inject({ method: "POST", url: "/api/schedules/hist/run", headers });

    const res = await app.inject({ method: "GET", url: "/api/schedules/hist/history", headers });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
  });

  it("GET /api/schedules/:id/history respects limit", async () => {
    await app.inject({
      method: "POST", url: "/api/schedules", headers,
      payload: { id: "hist-limit", every: "5m", prompt: "test" },
    });
    for (let i = 0; i < 5; i++) {
      await app.inject({ method: "POST", url: "/api/schedules/hist-limit/run", headers });
    }

    const res = await app.inject({ method: "GET", url: "/api/schedules/hist-limit/history?limit=2", headers });
    expect(res.json()).toHaveLength(2);
  });

  it("GET /api/schedules/:id/history returns 404 for unknown schedule", async () => {
    const res = await app.inject({ method: "GET", url: "/api/schedules/ghost/history", headers });
    expect(res.statusCode).toBe(404);
  });
});
