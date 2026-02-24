import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { ProcessManager } from "@mecha/process";
import type { CasaName } from "@mecha/core";
import { CasaNotFoundError, CasaNotRunningError } from "@mecha/contracts";
import { casaChat } from "../src/chat.js";

const CASA = "test" as CasaName;
const TOKEN = "test-token";

describe("casaChat", () => {
  let app: FastifyInstance;
  let port: number;
  let pm: ProcessManager;

  beforeEach(async () => {
    // Create a mock SSE chat server
    app = Fastify();
    app.post("/api/chat", async (_req, reply) => {
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      reply.raw.write(`data: ${JSON.stringify({ type: "text", content: "Hello " })}\n\n`);
      reply.raw.write(`data: ${JSON.stringify({ type: "done", sessionId: "s1" })}\n\n`);
      reply.raw.end();
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.server.address();
    port = typeof addr === "object" && addr ? addr.port : 0;

    pm = {
      spawn: vi.fn(),
      get: vi.fn().mockReturnValue({ name: CASA, state: "running" }),
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

  it("streams chat events", async () => {
    const stream = await casaChat(pm, CASA, { message: "Hello world" });
    const events: Array<{ type: string }> = [];

    for await (const event of stream) {
      events.push(event);
    }

    expect(events.length).toBeGreaterThan(0);
    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents.length).toBeGreaterThan(0);
    const doneEvents = events.filter((e) => e.type === "done");
    expect(doneEvents).toHaveLength(1);
  });

  it("throws CasaNotFoundError for unknown CASA", async () => {
    const badPm = {
      ...pm,
      getPortAndToken: vi.fn().mockReturnValue(undefined),
      get: vi.fn().mockReturnValue(undefined),
    } as unknown as ProcessManager;

    await expect(casaChat(badPm, CASA, { message: "Hi" })).rejects.toThrow(CasaNotFoundError);
  });

  it("throws CasaNotRunningError for stopped CASA", async () => {
    const badPm = {
      ...pm,
      getPortAndToken: vi.fn().mockReturnValue(undefined),
      get: vi.fn().mockReturnValue({ name: CASA, state: "stopped" }),
    } as unknown as ProcessManager;

    await expect(casaChat(badPm, CASA, { message: "Hi" })).rejects.toThrow(CasaNotRunningError);
  });

  it("throws on HTTP error from runtime", async () => {
    await app.close();

    app = Fastify();
    app.post("/api/chat", async (_req, reply) => {
      reply.code(500).send({ error: "Internal error" });
    });
    await app.listen({ port, host: "127.0.0.1" });

    await expect(casaChat(pm, CASA, { message: "Hi" })).rejects.toThrow("Internal error");
  });

  it("throws fallback message when error body has no .error field", async () => {
    await app.close();

    app = Fastify();
    app.post("/api/chat", async (_req, reply) => {
      reply.code(503).send({ detail: "no error field" });
    });
    await app.listen({ port, host: "127.0.0.1" });

    await expect(casaChat(pm, CASA, { message: "Hi" })).rejects.toThrow("Chat request failed: 503");
  });
});
