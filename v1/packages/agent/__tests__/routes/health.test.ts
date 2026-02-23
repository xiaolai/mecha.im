import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { registerHealthRoutes } from "../../src/routes/health.js";
import type { ProcessManager } from "@mecha/process";

vi.mock("node:os", async (importOriginal) => {
  const orig = await importOriginal<typeof import("node:os")>();
  return { ...orig, hostname: () => "test-machine" };
});

describe("health routes", () => {
  function buildApp(opts?: { nodeHealth?: unknown[]; listReturn?: unknown[] }) {
    const app = Fastify();
    const pm = {
      list: vi.fn().mockReturnValue(opts?.listReturn ?? []),
    } as unknown as ProcessManager;
    registerHealthRoutes(app, {
      pm,
      startedAt: Date.now() - 5000, // 5 seconds ago
      getNodeHealth: () => (opts?.nodeHealth ?? []) as never,
    });
    return { app, pm };
  }

  describe("GET /healthz", () => {
    it("returns status ok with node info and mecha count", async () => {
      const { app } = buildApp({ listReturn: [{}, {}, {}] });
      const res = await app.inject({ method: "GET", url: "/healthz" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe("ok");
      expect(body.node).toBe("test-machine");
      expect(body.mechaCount).toBe(3);
      expect(body.uptime).toBeGreaterThanOrEqual(4);
    });

    it("returns mechaCount 0 when ProcessManager throws", async () => {
      const { app, pm } = buildApp();
      (pm.list as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error("fail"); });
      const res = await app.inject({ method: "GET", url: "/healthz" });
      expect(res.statusCode).toBe(200);
      expect(res.json().mechaCount).toBe(0);
    });
  });

  describe("GET /nodes/health", () => {
    it("returns current node health data", async () => {
      const healthData = [
        { name: "node-a", host: "1.2.3.4:7660", status: "online", lastSeen: "2024-01-01T00:00:00Z", latencyMs: 5, mechaCount: 2 },
      ];
      const { app } = buildApp({ nodeHealth: healthData });
      const res = await app.inject({ method: "GET", url: "/nodes/health" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(healthData);
    });

    it("returns empty array when no nodes registered", async () => {
      const { app } = buildApp();
      const res = await app.inject({ method: "GET", url: "/nodes/health" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });
  });
});
