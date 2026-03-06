import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify from "fastify";
import { registerBotRoutes } from "../../src/routes/bots.js";
import type { BotName } from "@mecha/core";
import type { ProcessInfo } from "@mecha/process";
import { makePm } from "../../../service/__tests__/test-utils.js";

vi.mock("@mecha/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mecha/service")>();
  return {
    ...actual,
    getCachedSnapshot: vi.fn().mockReturnValue(null),
    checkBotBusy: vi.fn().mockResolvedValue({ busy: false, activeSessions: 0 }),
  };
});

describe("DELETE /bots/:name", () => {
  let mechaDir: string;

  beforeEach(() => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-test-"));
  });

  afterEach(() => {
    rmSync(mechaDir, { recursive: true, force: true });
  });

  it("removes a stopped bot and deletes its directory", async () => {
    const botDir = join(mechaDir, "alice");
    mkdirSync(botDir, { recursive: true });
    const stopped: ProcessInfo = { name: "alice" as BotName, state: "stopped", workspacePath: "/ws" };
    const pm = makePm([stopped]);
    const app = Fastify();
    registerBotRoutes(app, pm, mechaDir);
    await app.ready();

    const res = await app.inject({ method: "DELETE", url: "/bots/alice" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(existsSync(botDir)).toBe(false);
    await app.close();
  });

  it("stops a running bot before removing", async () => {
    const botDir = join(mechaDir, "alice");
    mkdirSync(botDir, { recursive: true });
    const running: ProcessInfo = { name: "alice" as BotName, state: "running", pid: 1, port: 7700, workspacePath: "/ws" };
    const pm = makePm([running]);
    const app = Fastify();
    registerBotRoutes(app, pm, mechaDir);
    await app.ready();

    const res = await app.inject({ method: "DELETE", url: "/bots/alice" });
    expect(res.statusCode).toBe(200);
    expect(pm.stop).toHaveBeenCalledWith("alice");
    expect(existsSync(botDir)).toBe(false);
    await app.close();
  });

  it("force-kills when ?force=true", async () => {
    const botDir = join(mechaDir, "alice");
    mkdirSync(botDir, { recursive: true });
    const running: ProcessInfo = { name: "alice" as BotName, state: "running", pid: 1, port: 7700, workspacePath: "/ws" };
    const pm = makePm([running]);
    const app = Fastify();
    registerBotRoutes(app, pm, mechaDir);
    await app.ready();

    const res = await app.inject({ method: "DELETE", url: "/bots/alice?force=true" });
    expect(res.statusCode).toBe(200);
    expect(pm.kill).toHaveBeenCalledWith("alice");
    await app.close();
  });

  it("returns 404 for nonexistent bot", async () => {
    const pm = makePm([]);
    const app = Fastify();
    registerBotRoutes(app, pm, mechaDir);
    await app.ready();

    const res = await app.inject({ method: "DELETE", url: "/bots/nonexistent" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("returns 400 for invalid name", async () => {
    const pm = makePm([]);
    const app = Fastify();
    registerBotRoutes(app, pm, mechaDir);
    await app.ready();

    const res = await app.inject({ method: "DELETE", url: "/bots/INVALID" });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
