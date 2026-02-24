import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type FastifyInstance } from "fastify";
import { createSessionManager, registerChatRoutes } from "@mecha/runtime";
import type { ProcessManager } from "@mecha/process";
import type { CasaName } from "@mecha/core";
import { CasaNotFoundError, CasaNotRunningError } from "@mecha/contracts";
import { casaChat } from "../src/chat.js";

const CASA = "test" as CasaName;
const TOKEN = "test-token";

describe("casaChat", () => {
  let app: FastifyInstance;
  let tempDir: string;
  let port: number;
  let pm: ProcessManager;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-svc-chat-"));
    const sm = createSessionManager(join(tempDir, "projects"));

    app = Fastify();
    registerChatRoutes(app, sm);
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
    rmSync(tempDir, { recursive: true, force: true });
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
    // Create a server that returns 500
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
