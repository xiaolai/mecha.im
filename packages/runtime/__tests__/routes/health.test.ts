import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerHealthRoutes } from "../../src/routes/health.js";

describe("health routes", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify();
    registerHealthRoutes(app, {
      casaName: "test-casa",
      port: 7700,
      startedAt: "2026-01-01T00:00:00Z",
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("GET /healthz returns ok", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("GET /info returns CASA info", async () => {
    const res = await app.inject({ method: "GET", url: "/info" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe("test-casa");
    expect(body.port).toBe(7700);
    expect(body.startedAt).toBe("2026-01-01T00:00:00Z");
    expect(typeof body.uptime).toBe("number");
  });
});
