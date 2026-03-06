import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { registerBotRoutes } from "../../src/routes/bots.js";
import type { BotName } from "@mecha/core";
import type { ProcessInfo } from "@mecha/process";
import { makePm } from "../../../service/__tests__/test-utils.js";

vi.mock("@mecha/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mecha/service")>();
  return {
    ...actual,
    batchBotAction: vi.fn(),
    getCachedSnapshot: vi.fn().mockReturnValue(null),
    checkBotBusy: vi.fn().mockResolvedValue({ busy: false, activeSessions: 0 }),
  };
});

const SPAWN_RESULT: ProcessInfo = {
  name: "test" as BotName,
  state: "running",
  port: 7700,
  workspacePath: "/tmp/ws",
};

describe("POST /bots — SpawnOpts passthrough", () => {
  it("passes model, tags, sandboxMode, permissionMode to pm.spawn", async () => {
    const pm = makePm([]);
    vi.mocked(pm.spawn).mockResolvedValue(SPAWN_RESULT);

    const app = Fastify();
    registerBotRoutes(app, pm, "/tmp/mecha");
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/bots",
      payload: {
        name: "test",
        workspacePath: "/tmp/ws",
        model: "claude-sonnet-4-20250514",
        tags: ["dev", "staging"],
        sandboxMode: "require",
        permissionMode: "plan",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(pm.spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "test",
        workspacePath: "/tmp/ws",
        model: "claude-sonnet-4-20250514",
        tags: ["dev", "staging"],
        sandboxMode: "require",
        permissionMode: "plan",
      }),
    );
    await app.close();
  });

  it("passes expose as string[] (not boolean)", async () => {
    const pm = makePm([]);
    vi.mocked(pm.spawn).mockResolvedValue(SPAWN_RESULT);

    const app = Fastify();
    registerBotRoutes(app, pm, "/tmp/mecha");
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/bots",
      payload: {
        name: "test",
        workspacePath: "/tmp/ws",
        expose: ["chat", "query"],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(pm.spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        expose: ["chat", "query"],
      }),
    );
    await app.close();
  });

  it("passes meterOff: true when meterOff is set", async () => {
    const pm = makePm([]);
    vi.mocked(pm.spawn).mockResolvedValue(SPAWN_RESULT);

    const app = Fastify();
    registerBotRoutes(app, pm, "/tmp/mecha");
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/bots",
      payload: {
        name: "test",
        workspacePath: "/tmp/ws",
        meterOff: true,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(pm.spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        meterOff: true,
      }),
    );
    await app.close();
  });

  it("passes auth profile name when auth is set", async () => {
    const pm = makePm([]);
    vi.mocked(pm.spawn).mockResolvedValue(SPAWN_RESULT);

    const app = Fastify();
    registerBotRoutes(app, pm, "/tmp/mecha");
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/bots",
      payload: {
        name: "test",
        workspacePath: "/tmp/ws",
        auth: "my-profile",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(pm.spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: "my-profile",
      }),
    );
    await app.close();
  });

  it("does not pass optional fields when not provided", async () => {
    const pm = makePm([]);
    vi.mocked(pm.spawn).mockResolvedValue(SPAWN_RESULT);

    const app = Fastify();
    registerBotRoutes(app, pm, "/tmp/mecha");
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/bots",
      payload: {
        name: "test",
        workspacePath: "/tmp/ws",
      },
    });

    expect(res.statusCode).toBe(200);
    const spawnArg = vi.mocked(pm.spawn).mock.calls[0][0];
    expect(spawnArg).toEqual({
      name: "test",
      workspacePath: "/tmp/ws",
    });
    await app.close();
  });
});
