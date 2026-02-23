import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { createBearerAuth } from "../src/auth.js";

describe("createBearerAuth", () => {
  const API_KEY = "test-secret-key";

  function buildApp() {
    const app = Fastify();
    app.addHook("preHandler", createBearerAuth(API_KEY));
    app.get("/healthz", async () => ({ status: "ok" }));
    app.get("/mechas", async () => ({ items: [] }));
    return app;
  }

  it("allows /healthz without authorization", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("allows /healthz with query parameters without authorization", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/healthz?verbose=1" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("allows requests with valid Bearer token", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/mechas",
      headers: { authorization: `Bearer ${API_KEY}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it("rejects requests with no authorization header", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/mechas" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "Missing or invalid Authorization header" });
  });

  it("rejects requests with non-Bearer auth scheme", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/mechas",
      headers: { authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "Missing or invalid Authorization header" });
  });

  it("rejects requests with wrong API key", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/mechas",
      headers: { authorization: "Bearer wrong-key" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "Invalid API key" });
  });
});
