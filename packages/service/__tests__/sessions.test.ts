import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import Fastify, { type FastifyInstance } from "fastify";
import { createSessionManager, registerSessionRoutes } from "@mecha/runtime";
import type { ProcessManager } from "@mecha/process";
import type { CasaName } from "@mecha/core";
import {
  casaSessionList,
  casaSessionGet,
} from "../src/sessions.js";

const CASA = "test" as CasaName;
const TOKEN = "test-token";

describe("session service (read-only)", () => {
  let app: FastifyInstance;
  let tempDir: string;
  let projectsDir: string;
  let port: number;
  let pm: ProcessManager;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-svc-sessions-"));
    projectsDir = join(tempDir, "projects");
    mkdirSync(projectsDir, { recursive: true });

    const sm = createSessionManager(projectsDir);
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
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("lists sessions (empty)", async () => {
    const result = await casaSessionList(pm, CASA);
    expect(result).toEqual([]);
  });

  it("lists sessions from filesystem", async () => {
    writeFileSync(
      join(projectsDir, "abc.meta.json"),
      JSON.stringify({ id: "abc", title: "Research", starred: false, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }),
    );
    const result = await casaSessionList(pm, CASA);
    expect(result).toHaveLength(1);
    expect((result[0] as { title: string }).title).toBe("Research");
  });

  it("gets a session with transcript", async () => {
    writeFileSync(
      join(projectsDir, "sess-1.meta.json"),
      JSON.stringify({ id: "sess-1", title: "Test", starred: false, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }),
    );
    writeFileSync(
      join(projectsDir, "sess-1.jsonl"),
      '{"type":"user","content":"Hello"}\n',
    );
    const result = await casaSessionGet(pm, CASA, "sess-1");
    expect((result as { title: string }).title).toBe("Test");
    expect((result as { events: unknown[] }).events).toHaveLength(1);
  });

  it("returns undefined for nonexistent session", async () => {
    const result = await casaSessionGet(pm, CASA, "nonexistent");
    expect(result).toBeUndefined();
  });
});

describe("session service error paths", () => {
  let errServer: Server;
  let errPort: number;
  let pm: ProcessManager;

  beforeEach(async () => {
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
});
