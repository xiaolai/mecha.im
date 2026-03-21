import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { createAuthHook } from "../src/auth.js";

describe("createAuthHook", () => {
  let app: FastifyInstance;
  const TOKEN = "test-token-123";

  beforeEach(async () => {
    app = Fastify();
    app.addHook("onRequest", createAuthHook(TOKEN));
    app.get("/healthz", async () => ({ status: "ok" }));
    app.get("/protected", async () => ({ data: "secret" }));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("allows /healthz without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("rejects requests without Authorization header", async () => {
    const res = await app.inject({ method: "GET", url: "/protected" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "Missing Authorization header" });
  });

  it("rejects requests with invalid token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: "Bearer wrong-token" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "Invalid token" });
  });

  it("rejects malformed Authorization header", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: "Basic abc" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "Invalid token" });
  });

  it("rejects Authorization header with extra parts", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: "Bearer token extra" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "Invalid token" });
  });

  it("allows requests with valid Bearer token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: "secret" });
  });
});
