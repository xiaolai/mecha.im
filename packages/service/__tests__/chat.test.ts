import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { ProcessManager } from "@mecha/process";
import { type BotName, BotNotFoundError, BotNotRunningError } from "@mecha/core";
import { botChat } from "../src/chat.js";

const BOT = "test" as BotName;
const TOKEN = "test-token";

describe("botChat", () => {
  let app: FastifyInstance;
  let port: number;
  let pm: ProcessManager;

  beforeEach(async () => {
    app = Fastify();
    app.post("/api/chat", async (req, reply) => {
      const body = req.body as { message: string; sessionId?: string };
      reply.send({
        response: `Echo: ${body.message}`,
        sessionId: body.sessionId ?? "s1",
        durationMs: 42,
        costUsd: 0.001,
      });
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.server.address();
    port = typeof addr === "object" && addr ? addr.port : 0;

    pm = {
      spawn: vi.fn(),
      get: vi.fn().mockReturnValue({ name: BOT, state: "running" }),
      list: vi.fn().mockReturnValue([]),
      stop: vi.fn(),
      kill: vi.fn(),
      logs: vi.fn(),
      getPortAndToken: vi.fn().mockReturnValue({ port, token: TOKEN }),
      onEvent: vi.fn().mockReturnValue(() => {}),
    } as ProcessManager;
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns chat result", async () => {
    const result = await botChat(pm, BOT, { message: "Hello world" });
    expect(result.response).toBe("Echo: Hello world");
    expect(result.sessionId).toBe("s1");
    expect(result.durationMs).toBe(42);
    expect(result.costUsd).toBe(0.001);
  });

  it("passes sessionId through", async () => {
    const result = await botChat(pm, BOT, { message: "Hi", sessionId: "my-session" });
    expect(result.sessionId).toBe("my-session");
  });

  it("works with external AbortSignal", async () => {
    const ac = new AbortController();
    const result = await botChat(pm, BOT, { message: "Hello" }, ac.signal);
    expect(result.response).toBe("Echo: Hello");
  });

  it("throws BotNotFoundError for unknown bot", async () => {
    const badPm = {
      ...pm,
      getPortAndToken: vi.fn().mockReturnValue(undefined),
      get: vi.fn().mockReturnValue(undefined),
    } as unknown as ProcessManager;

    await expect(botChat(badPm, BOT, { message: "Hi" })).rejects.toThrow(BotNotFoundError);
  });

  it("throws BotNotRunningError for stopped bot", async () => {
    const badPm = {
      ...pm,
      getPortAndToken: vi.fn().mockReturnValue(undefined),
      get: vi.fn().mockReturnValue({ name: BOT, state: "stopped" }),
    } as unknown as ProcessManager;

    await expect(botChat(badPm, BOT, { message: "Hi" })).rejects.toThrow(BotNotRunningError);
  });

  it("throws on HTTP error from runtime", async () => {
    await app.close();

    app = Fastify();
    app.post("/api/chat", async (_req, reply) => {
      reply.code(500).send({ error: "Internal error" });
    });
    await app.listen({ port, host: "127.0.0.1" });

    await expect(botChat(pm, BOT, { message: "Hi" })).rejects.toThrow("Internal error");
  });

  it("throws fallback message when error body has no .error field", async () => {
    await app.close();

    app = Fastify();
    app.post("/api/chat", async (_req, reply) => {
      reply.code(503).send({ detail: "no error field" });
    });
    await app.listen({ port, host: "127.0.0.1" });

    await expect(botChat(pm, BOT, { message: "Hi" })).rejects.toThrow("Chat request failed: 503");
  });
});
