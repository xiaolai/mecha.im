import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type FastifyInstance } from "fastify";
import { registerSessionRoutes } from "../../src/routes/sessions.js";
import type { ProcessManager } from "@mecha/process";

vi.mock("@mecha/service", () => ({
  botSessionList: vi.fn(),
  botSessionGet: vi.fn(),
  botSessionDelete: vi.fn(),
}));

import { botSessionList, botSessionGet, botSessionDelete } from "@mecha/service";
const mockList = vi.mocked(botSessionList);
const mockGet = vi.mocked(botSessionGet);
const mockDelete = vi.mocked(botSessionDelete);

function createMockPm(running = true): ProcessManager {
  return {
    spawn: vi.fn(),
    get: vi.fn().mockImplementation((name: string) =>
      running ? { name, state: "running", workspacePath: "/ws" } : undefined,
    ),
    list: vi.fn().mockReturnValue([]),
    stop: vi.fn(),
    kill: vi.fn(),
    logs: vi.fn(),
    getPortAndToken: vi.fn(),
    onEvent: vi.fn().mockReturnValue(() => {}),
  } as unknown as ProcessManager;
}

describe("agent session routes", () => {
  let app: FastifyInstance;
  let pm: ProcessManager;
  let mechaDir: string;

  beforeEach(async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-sess-test-"));
    pm = createMockPm();
    app = Fastify();
    registerSessionRoutes(app, pm, mechaDir);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  describe("GET /bots/:name/sessions", () => {
    it("returns sessions list", async () => {
      mockList.mockResolvedValue([{ id: "s1", title: "Test" }]);
      const res = await app.inject({ method: "GET", url: "/bots/coder/sessions" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([{ id: "s1", title: "Test" }]);
    });

    it("returns 400 for invalid bot name", async () => {
      const res = await app.inject({ method: "GET", url: "/bots/in valid/sessions" });
      expect(res.statusCode).toBe(400);
    });

    it("returns 404 when bot not found", async () => {
      pm = createMockPm(false);
      app = Fastify();
      registerSessionRoutes(app, pm, mechaDir);
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/bots/ghost/sessions" });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /bots/:name/sessions/:id", () => {
    it("returns a session", async () => {
      mockGet.mockResolvedValue({ id: "s1", title: "Test", events: [] });
      const res = await app.inject({ method: "GET", url: "/bots/coder/sessions/s1" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ id: "s1", title: "Test", events: [] });
    });

    it("returns 404 when session not found", async () => {
      mockGet.mockResolvedValue(undefined);
      const res = await app.inject({ method: "GET", url: "/bots/coder/sessions/nope" });
      expect(res.statusCode).toBe(404);
    });

    it("returns 400 for invalid bot name", async () => {
      const res = await app.inject({ method: "GET", url: "/bots/in valid/sessions/s1" });
      expect(res.statusCode).toBe(400);
    });

    it("returns 404 when bot not found", async () => {
      pm = createMockPm(false);
      app = Fastify();
      registerSessionRoutes(app, pm, mechaDir);
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/bots/ghost/sessions/s1" });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("DELETE /bots/:name/sessions/:id", () => {
    it("deletes a session", async () => {
      mockDelete.mockResolvedValue(true);
      const res = await app.inject({ method: "DELETE", url: "/bots/coder/sessions/s1" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    });

    it("returns 404 when session not found", async () => {
      mockDelete.mockResolvedValue(false);
      const res = await app.inject({ method: "DELETE", url: "/bots/coder/sessions/nope" });
      expect(res.statusCode).toBe(404);
    });

    it("returns 400 for invalid bot name", async () => {
      const res = await app.inject({ method: "DELETE", url: "/bots/in valid/sessions/s1" });
      expect(res.statusCode).toBe(400);
    });

    it("returns 404 when bot not found", async () => {
      pm = createMockPm(false);
      app = Fastify();
      registerSessionRoutes(app, pm, mechaDir);
      await app.ready();

      const res = await app.inject({ method: "DELETE", url: "/bots/ghost/sessions/s1" });
      expect(res.statusCode).toBe(404);
    });
  });
});
