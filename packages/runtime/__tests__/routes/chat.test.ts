import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { DEFAULTS } from "@mecha/core";
import { registerChatRoutes, type HttpChatFn } from "../../src/routes/chat.js";

describe("chat routes", () => {
  let app: FastifyInstance;

  const mockChatFn: HttpChatFn = async (message, sessionId) => ({
    response: `Echo: ${message}`,
    sessionId: sessionId ?? "test-session-id",
    durationMs: 42,
    costUsd: 0.001,
  });

  beforeEach(async () => {
    app = Fastify();
    registerChatRoutes(app, mockChatFn);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns 200 with response for valid message", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "Hello" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.response).toBe("Echo: Hello");
    expect(body.sessionId).toBe("test-session-id");
    expect(body.durationMs).toBe(42);
    expect(body.costUsd).toBe(0.001);
  });

  it("passes sessionId when provided", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "Hello", sessionId: "my-session" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().sessionId).toBe("my-session");
  });

  it("returns 400 when message is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("message is required");
  });

  it("returns 400 when message is not a string", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: 123 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("message is required");
  });

  it("returns 413 when message exceeds max size", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "x".repeat(DEFAULTS.RELAY_MAX_MESSAGE_BYTES + 1) },
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().error).toContain("message too large");
  });

  it("returns 400 when sessionId is not a string", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "Hello", sessionId: 123 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("sessionId must be a string");
  });

  it("returns 500 when chatFn throws", async () => {
    const failApp = Fastify();
    const failChatFn: HttpChatFn = async () => {
      throw new Error("SDK exploded");
    };
    registerChatRoutes(failApp, failChatFn);
    await failApp.ready();

    const res = await failApp.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "Hello" },
    });
    expect(res.statusCode).toBe(500);
    await failApp.close();
  });
});
