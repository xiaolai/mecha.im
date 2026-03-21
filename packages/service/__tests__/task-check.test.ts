import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type FastifyInstance } from "fastify";
import { createSessionManager, registerSessionRoutes } from "@mecha/runtime";
import type { ProcessManager } from "@mecha/process";
import type { BotName } from "@mecha/core";
import { checkBotBusy } from "../src/task-check.js";

const BOT = "test" as BotName;
const TOKEN = "test-token";

describe("checkBotBusy", () => {
  let app: FastifyInstance;
  let tempDir: string;
  let projectsDir: string;
  let port: number;
  let pm: ProcessManager;

  function makePm(state: "running" | "stopped" = "running"): ProcessManager {
    return {
      spawn: vi.fn(),
      get: vi.fn().mockReturnValue({ name: BOT, state }),
      list: vi.fn().mockReturnValue([]),
      stop: vi.fn(),
      kill: vi.fn(),
      logs: vi.fn(),
      getPortAndToken: vi.fn().mockReturnValue({ port, token: TOKEN }),
      onEvent: vi.fn().mockReturnValue(() => {}),
    } as ProcessManager;
  }

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-task-check-"));
    projectsDir = join(tempDir, "projects");
    mkdirSync(projectsDir, { recursive: true });

    const sm = createSessionManager(projectsDir);
    app = Fastify();
    registerSessionRoutes(app, sm);
    await app.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.server.address();
    port = typeof addr === "object" && addr ? addr.port : 0;
    pm = makePm();
  });

  afterEach(async () => {
    await app.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns busy: false when bot is not running", async () => {
    const stoppedPm = makePm("stopped");
    const result = await checkBotBusy(stoppedPm, BOT);
    expect(result).toEqual({ busy: false, activeSessions: 0 });
  });

  it("returns busy: false when bot is not found", async () => {
    const emptyPm: ProcessManager = {
      spawn: vi.fn(),
      get: vi.fn().mockReturnValue(undefined),
      list: vi.fn().mockReturnValue([]),
      stop: vi.fn(),
      kill: vi.fn(),
      logs: vi.fn(),
      getPortAndToken: vi.fn(),
      onEvent: vi.fn().mockReturnValue(() => {}),
    } as ProcessManager;
    const result = await checkBotBusy(emptyPm, BOT);
    expect(result).toEqual({ busy: false, activeSessions: 0 });
  });

  it("returns busy: false when no sessions exist", async () => {
    const result = await checkBotBusy(pm, BOT);
    expect(result).toEqual({ busy: false, activeSessions: 0 });
  });

  it("returns busy: false when sessions are stale", async () => {
    const staleTime = new Date(Date.now() - 120_000).toISOString();
    writeFileSync(
      join(projectsDir, "old.meta.json"),
      JSON.stringify({
        id: "old",
        title: "Old Session",
        starred: false,
        createdAt: staleTime,
        updatedAt: staleTime,
      }),
    );
    const result = await checkBotBusy(pm, BOT);
    expect(result.busy).toBe(false);
    expect(result.activeSessions).toBe(0);
  });

  it("returns busy: true when sessions are recent", async () => {
    const recentTime = new Date().toISOString();
    writeFileSync(
      join(projectsDir, "active.meta.json"),
      JSON.stringify({
        id: "active",
        title: "Active Session",
        starred: false,
        createdAt: recentTime,
        updatedAt: recentTime,
      }),
    );
    const result = await checkBotBusy(pm, BOT);
    expect(result.busy).toBe(true);
    expect(result.activeSessions).toBe(1);
    expect(result.lastActivity).toBe(recentTime);
  });

  it("respects custom recencyMs threshold", async () => {
    // Session updated 30s ago
    const thirtySecsAgo = new Date(Date.now() - 30_000).toISOString();
    writeFileSync(
      join(projectsDir, "mid.meta.json"),
      JSON.stringify({
        id: "mid",
        title: "Mid Session",
        starred: false,
        createdAt: thirtySecsAgo,
        updatedAt: thirtySecsAgo,
      }),
    );

    // With default 60s → busy
    const result1 = await checkBotBusy(pm, BOT);
    expect(result1.busy).toBe(true);

    // With 10s threshold → not busy
    const result2 = await checkBotBusy(pm, BOT, 10_000);
    expect(result2.busy).toBe(false);
  });

  it("returns busy: false when runtime is unreachable", async () => {
    // Point to a port that nothing is listening on
    const badPm: ProcessManager = {
      spawn: vi.fn(),
      get: vi.fn().mockReturnValue({ name: BOT, state: "running" }),
      list: vi.fn().mockReturnValue([]),
      stop: vi.fn(),
      kill: vi.fn(),
      logs: vi.fn(),
      getPortAndToken: vi.fn().mockReturnValue({ port: 1, token: TOKEN }),
      onEvent: vi.fn().mockReturnValue(() => {}),
    } as ProcessManager;
    const result = await checkBotBusy(badPm, BOT);
    expect(result).toEqual({ busy: false, activeSessions: 0 });
  });
});
