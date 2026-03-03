import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerSessionRoutes } from "../../src/routes/sessions.js";
import type { ProcessManager } from "@mecha/process";

vi.mock("@mecha/service", () => ({
  casaSessionList: vi.fn(),
  casaSessionGet: vi.fn(),
  casaSessionDelete: vi.fn(),
}));

import { casaSessionList, casaSessionGet, casaSessionDelete } from "@mecha/service";
const mockList = vi.mocked(casaSessionList);
const mockGet = vi.mocked(casaSessionGet);
const mockDelete = vi.mocked(casaSessionDelete);

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

  beforeEach(async () => {
    pm = createMockPm();
    app = Fastify();
    registerSessionRoutes(app, pm);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  describe("GET /casas/:name/sessions", () => {
    it("returns sessions list", async () => {
      mockList.mockResolvedValue([{ id: "s1", title: "Test" }]);
      const res = await app.inject({ method: "GET", url: "/casas/coder/sessions" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([{ id: "s1", title: "Test" }]);
    });

    it("returns 400 for invalid CASA name", async () => {
      const res = await app.inject({ method: "GET", url: "/casas/in valid/sessions" });
      expect(res.statusCode).toBe(400);
    });

    it("returns 404 when CASA not found", async () => {
      pm = createMockPm(false);
      app = Fastify();
      registerSessionRoutes(app, pm);
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/casas/ghost/sessions" });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /casas/:name/sessions/:id", () => {
    it("returns a session", async () => {
      mockGet.mockResolvedValue({ id: "s1", title: "Test", events: [] });
      const res = await app.inject({ method: "GET", url: "/casas/coder/sessions/s1" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ id: "s1", title: "Test", events: [] });
    });

    it("returns 404 when session not found", async () => {
      mockGet.mockResolvedValue(undefined);
      const res = await app.inject({ method: "GET", url: "/casas/coder/sessions/nope" });
      expect(res.statusCode).toBe(404);
    });

    it("returns 400 for invalid CASA name", async () => {
      const res = await app.inject({ method: "GET", url: "/casas/in valid/sessions/s1" });
      expect(res.statusCode).toBe(400);
    });

    it("returns 404 when CASA not found", async () => {
      pm = createMockPm(false);
      app = Fastify();
      registerSessionRoutes(app, pm);
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/casas/ghost/sessions/s1" });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("DELETE /casas/:name/sessions/:id", () => {
    it("deletes a session", async () => {
      mockDelete.mockResolvedValue(true);
      const res = await app.inject({ method: "DELETE", url: "/casas/coder/sessions/s1" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    });

    it("returns 404 when session not found", async () => {
      mockDelete.mockResolvedValue(false);
      const res = await app.inject({ method: "DELETE", url: "/casas/coder/sessions/nope" });
      expect(res.statusCode).toBe(404);
    });

    it("returns 400 for invalid CASA name", async () => {
      const res = await app.inject({ method: "DELETE", url: "/casas/in valid/sessions/s1" });
      expect(res.statusCode).toBe(400);
    });

    it("returns 404 when CASA not found", async () => {
      pm = createMockPm(false);
      app = Fastify();
      registerSessionRoutes(app, pm);
      await app.ready();

      const res = await app.inject({ method: "DELETE", url: "/casas/ghost/sessions/s1" });
      expect(res.statusCode).toBe(404);
    });
  });
});
