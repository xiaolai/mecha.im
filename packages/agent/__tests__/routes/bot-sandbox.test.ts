import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify from "fastify";
import { registerBotRoutes } from "../../src/routes/bots.js";
import { makePm } from "../../../service/__tests__/test-utils.js";

vi.mock("@mecha/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mecha/service")>();
  return {
    ...actual,
    getCachedSnapshot: vi.fn().mockReturnValue(null),
    checkBotBusy: vi.fn().mockResolvedValue({ busy: false, activeSessions: 0 }),
  };
});

describe("GET /bots/:name/sandbox", () => {
  let mechaDir: string;

  beforeEach(() => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-test-"));
  });

  afterEach(() => {
    rmSync(mechaDir, { recursive: true, force: true });
  });

  it("returns sandbox profile for a bot", async () => {
    const botDir = join(mechaDir, "alice");
    mkdirSync(join(botDir, ".claude", "hooks"), { recursive: true });
    writeFileSync(join(botDir, ".claude", "settings.json"), JSON.stringify({ hooks: true }));
    writeFileSync(join(botDir, ".claude", "hooks", "sandbox-guard.sh"), "#!/bin/bash");
    writeFileSync(join(botDir, "config.json"), JSON.stringify({ workspace: "/ws", port: 7700, token: "tok", sandboxMode: "require" }));

    const app = Fastify();
    registerBotRoutes(app, makePm([]), mechaDir);
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/bots/alice/sandbox" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe("alice");
    expect(body.sandboxMode).toBe("require");
    expect(body.settings).toEqual({ hooks: true });
    expect(body.hooks).toContain("sandbox-guard.sh");
    await app.close();
  });

  it("returns 404 for nonexistent bot", async () => {
    const app = Fastify();
    registerBotRoutes(app, makePm([]), mechaDir);
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/bots/nope/sandbox" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("returns defaults when no .claude directory", async () => {
    const botDir = join(mechaDir, "alice");
    mkdirSync(botDir, { recursive: true });
    writeFileSync(join(botDir, "config.json"), JSON.stringify({ workspace: "/ws", port: 7700, token: "tok" }));

    const app = Fastify();
    registerBotRoutes(app, makePm([]), mechaDir);
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/bots/alice/sandbox" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sandboxMode).toBe("auto");
    expect(body.settings).toEqual({});
    expect(body.hooks).toEqual([]);
    await app.close();
  });

  it("filters non-.sh files from hooks", async () => {
    const botDir = join(mechaDir, "alice");
    mkdirSync(join(botDir, ".claude", "hooks"), { recursive: true });
    writeFileSync(join(botDir, ".claude", "hooks", "guard.sh"), "#!/bin/bash");
    writeFileSync(join(botDir, ".claude", "hooks", "readme.txt"), "not a hook");
    writeFileSync(join(botDir, "config.json"), JSON.stringify({ workspace: "/ws", port: 7700, token: "tok" }));

    const app = Fastify();
    registerBotRoutes(app, makePm([]), mechaDir);
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/bots/alice/sandbox" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.hooks).toEqual(["guard.sh"]);
    expect(body.hooks).not.toContain("readme.txt");
    await app.close();
  });

  it("returns 400 for invalid bot name", async () => {
    const app = Fastify();
    registerBotRoutes(app, makePm([]), mechaDir);
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/bots/bad%20name/sandbox" });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
