import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { ActivityEmitter } from "../../src/activity.js";
import { registerActivityEventsRoutes } from "../../src/routes/events.js";

describe("bot activity events SSE route", () => {
  let app: FastifyInstance;
  let emitter: ActivityEmitter;

  beforeEach(async () => {
    app = Fastify();
    emitter = new ActivityEmitter();
    registerActivityEventsRoutes(app, { activityEmitter: emitter, botName: "alice" });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("registers GET /api/events route", () => {
    // printRoutes uses a compressed tree format; check both endpoints individually
    expect(app.hasRoute({ method: "GET", url: "/api/events" })).toBe(true);
    expect(app.hasRoute({ method: "GET", url: "/api/events/snapshot" })).toBe(true);
  });

  it("returns snapshot event on initial connection", async () => {
    // Snapshot endpoint (non-SSE) for testing
    const res = await app.inject({
      method: "GET",
      url: "/api/events/snapshot",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe("alice");
    expect(body.activity).toBe("idle");
  });
});
