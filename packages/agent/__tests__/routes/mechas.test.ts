import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerMechaRoutes } from "../../src/routes/mechas.js";
import type { ProcessManager } from "@mecha/process";

const mockMechaLs = vi.fn();
const mockMechaUp = vi.fn();
const mockMechaRm = vi.fn();
const mockMechaStart = vi.fn();
const mockMechaStop = vi.fn();

vi.mock("@mecha/service", () => ({
  mechaLs: (...args: unknown[]) => mockMechaLs(...args),
  mechaUp: (...args: unknown[]) => mockMechaUp(...args),
  mechaRm: (...args: unknown[]) => mockMechaRm(...args),
  mechaStart: (...args: unknown[]) => mockMechaStart(...args),
  mechaStop: (...args: unknown[]) => mockMechaStop(...args),
}));

vi.mock("@mecha/contracts", () => ({
  MechaUpInput: { parse: (v: unknown) => v },
  toHttpStatus: (err: unknown) => (err instanceof Error && err.message.includes("not found") ? 404 : 500),
  toSafeMessage: (err: unknown) => (err instanceof Error ? err.message : "Unknown error"),
}));

describe("mecha routes", () => {
  const pm = {} as ProcessManager;

  function buildApp() {
    const app = Fastify();
    registerMechaRoutes(app, pm);
    return app;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /mechas", () => {
    it("returns list of mechas", async () => {
      const items = [{ id: "m1", name: "mecha-m1", state: "running", status: "Up 1h", path: "/p", port: 7700, created: 0 }];
      mockMechaLs.mockResolvedValue(items);
      const res = await buildApp().inject({ method: "GET", url: "/mechas" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(items);
    });

    it("returns error on failure", async () => {
      mockMechaLs.mockRejectedValue(new Error("not found"));
      const res = await buildApp().inject({ method: "GET", url: "/mechas" });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "not found" });
    });
  });

  describe("POST /mechas", () => {
    it("creates a mecha and returns 201", async () => {
      const result = { id: "m2", name: "mecha-m2", port: 7701, authToken: "tok" };
      mockMechaUp.mockResolvedValue(result);
      const res = await buildApp().inject({
        method: "POST",
        url: "/mechas",
        payload: { projectPath: "/project" },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual(result);
    });

    it("returns error status on failure", async () => {
      mockMechaUp.mockRejectedValue(new Error("not found"));
      const res = await buildApp().inject({
        method: "POST",
        url: "/mechas",
        payload: { projectPath: "/bad" },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "not found" });
    });
  });

  describe("DELETE /mechas/:id", () => {
    it("removes a mecha", async () => {
      mockMechaRm.mockResolvedValue(undefined);
      const res = await buildApp().inject({ method: "DELETE", url: "/mechas/m1" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    });

    it("returns error on failure", async () => {
      mockMechaRm.mockRejectedValue(new Error("not found"));
      const res = await buildApp().inject({ method: "DELETE", url: "/mechas/m1" });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "not found" });
    });
  });

  describe("POST /mechas/:id/start", () => {
    it("starts a mecha", async () => {
      mockMechaStart.mockResolvedValue(undefined);
      const res = await buildApp().inject({ method: "POST", url: "/mechas/m1/start" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    });

    it("returns error on failure", async () => {
      mockMechaStart.mockRejectedValue(new Error("start failed"));
      const res = await buildApp().inject({ method: "POST", url: "/mechas/m1/start" });
      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ error: "start failed" });
    });
  });

  describe("POST /mechas/:id/stop", () => {
    it("stops a mecha", async () => {
      mockMechaStop.mockResolvedValue(undefined);
      const res = await buildApp().inject({ method: "POST", url: "/mechas/m1/stop" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    });

    it("returns error on failure", async () => {
      mockMechaStop.mockRejectedValue(new Error("stop failed"));
      const res = await buildApp().inject({ method: "POST", url: "/mechas/m1/stop" });
      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ error: "stop failed" });
    });
  });
});
