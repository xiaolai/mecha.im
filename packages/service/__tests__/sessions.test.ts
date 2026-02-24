import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { runMigrations } from "@mecha/runtime";
import { createSessionManager } from "@mecha/runtime";
import { registerSessionRoutes } from "@mecha/runtime";
import type { ProcessManager } from "@mecha/process";
import type { CasaName } from "@mecha/core";
import {
  casaSessionList,
  casaSessionGet,
  casaSessionCreate,
  casaSessionDelete,
  casaSessionRename,
  casaSessionMessage,
  casaSessionInterrupt,
} from "../src/sessions.js";

const CASA = "test" as CasaName;
const TOKEN = "test-token";

describe("session service", () => {
  let app: FastifyInstance;
  let db: InstanceType<typeof Database>;
  let tempDir: string;
  let port: number;
  let pm: ProcessManager;
  let sm: ReturnType<typeof createSessionManager>;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-svc-sessions-"));
    db = new Database(":memory:");
    runMigrations(db);
    sm = createSessionManager(db, join(tempDir, "transcripts"));

    app = Fastify();
    registerSessionRoutes(app, sm);
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
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("lists sessions (empty)", async () => {
    const result = await casaSessionList(pm, CASA);
    expect(result).toEqual([]);
  });

  it("creates a session", async () => {
    const result = await casaSessionCreate(pm, CASA, { title: "My Session" });
    expect((result as { title: string }).title).toBe("My Session");
  });

  it("creates a session without options", async () => {
    const result = await casaSessionCreate(pm, CASA);
    expect((result as { id: string }).id).toBeDefined();
  });

  it("gets a session", async () => {
    const created = (await casaSessionCreate(pm, CASA, { title: "Test" })) as { id: string };
    const result = await casaSessionGet(pm, CASA, created.id);
    expect((result as { title: string }).title).toBe("Test");
  });

  it("returns undefined for nonexistent session", async () => {
    const result = await casaSessionGet(pm, CASA, "nonexistent");
    expect(result).toBeUndefined();
  });

  it("deletes a session", async () => {
    const created = (await casaSessionCreate(pm, CASA)) as { id: string };
    const deleted = await casaSessionDelete(pm, CASA, created.id);
    expect(deleted).toBe(true);
  });

  it("returns false when deleting nonexistent session", async () => {
    const result = await casaSessionDelete(pm, CASA, "nonexistent");
    expect(result).toBe(false);
  });

  it("returns false when renaming nonexistent session", async () => {
    const result = await casaSessionRename(pm, CASA, "nonexistent", "New");
    expect(result).toBe(false);
  });

  it("renames a session", async () => {
    const created = (await casaSessionCreate(pm, CASA, { title: "Old" })) as { id: string };
    const renamed = await casaSessionRename(pm, CASA, created.id, "New");
    expect(renamed).toBe(true);
  });

  it("sends a message to a session", async () => {
    const created = (await casaSessionCreate(pm, CASA)) as { id: string };
    const result = await casaSessionMessage(pm, CASA, created.id, {
      role: "user",
      content: "Hello",
    });
    expect((result as { role: string }).role).toBe("user");
  });

  it("interrupts a non-busy session returns false (409)", async () => {
    const created = (await casaSessionCreate(pm, CASA)) as { id: string };
    const result = await casaSessionInterrupt(pm, CASA, created.id);
    expect(result).toBe(false);
  });

  it("interrupts a busy session returns true (200)", async () => {
    const created = (await casaSessionCreate(pm, CASA)) as { id: string };
    // Make the session busy via chat, then interrupt
    sm.setBusy(created.id, true);
    const result = await casaSessionInterrupt(pm, CASA, created.id);
    expect(result).toBe(true);
  });
});

describe("session service error paths", () => {
  let errServer: Server;
  let errPort: number;
  let pm: ProcessManager;

  beforeEach(async () => {
    // Simple HTTP server that always returns 500
    errServer = createServer((_, res) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "internal" }));
    });
    await new Promise<void>((resolve) => errServer.listen(0, "127.0.0.1", resolve));
    const addr = errServer.address();
    errPort = typeof addr === "object" && addr ? addr.port : 0;

    pm = {
      spawn: vi.fn(),
      get: vi.fn().mockReturnValue({ name: CASA, state: "running" }),
      list: vi.fn().mockReturnValue([]),
      stop: vi.fn(),
      kill: vi.fn(),
      logs: vi.fn(),
      getPortAndToken: vi.fn().mockReturnValue({ port: errPort, token: TOKEN }),
      onEvent: vi.fn().mockReturnValue(() => {}),
    } as ProcessManager;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => errServer.close(() => resolve()));
  });

  it("throws on unexpected list status", async () => {
    await expect(casaSessionList(pm, CASA)).rejects.toThrow("Failed to list sessions: 500");
  });

  it("throws on unexpected get status", async () => {
    await expect(casaSessionGet(pm, CASA, "x")).rejects.toThrow("Failed to get session: 500");
  });

  it("throws on unexpected create status", async () => {
    await expect(casaSessionCreate(pm, CASA)).rejects.toThrow("Failed to create session: 500");
  });

  it("throws on unexpected delete status", async () => {
    await expect(casaSessionDelete(pm, CASA, "x")).rejects.toThrow("Failed to delete session: 500");
  });

  it("throws on unexpected rename status", async () => {
    await expect(casaSessionRename(pm, CASA, "x", "t")).rejects.toThrow("Failed to rename session: 500");
  });

  it("throws on unexpected message status", async () => {
    await expect(casaSessionMessage(pm, CASA, "x", { role: "user", content: "hi" })).rejects.toThrow("Failed to send message: 500");
  });

  it("throws on unexpected interrupt status", async () => {
    await expect(casaSessionInterrupt(pm, CASA, "x")).rejects.toThrow("Failed to interrupt session: 500");
  });
});
