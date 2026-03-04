import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerScheduleOverviewRoutes } from "../../src/routes/schedule-overview.js";
import type { ProcessManager } from "@mecha/process";

vi.mock("@mecha/service", () => ({
  botScheduleList: vi.fn(),
}));

import { botScheduleList } from "@mecha/service";

const mockList = vi.mocked(botScheduleList);

function createMockPm(bots: Array<{ name: string; state: string }> = []): ProcessManager {
  return {
    spawn: vi.fn(),
    get: vi.fn(),
    list: vi.fn().mockReturnValue(
      bots.map((b) => ({ name: b.name, state: b.state, workspacePath: "/ws" })),
    ),
    stop: vi.fn(),
    kill: vi.fn(),
    logs: vi.fn(),
    getPortAndToken: vi.fn(),
    onEvent: vi.fn().mockReturnValue(() => {}),
  } as unknown as ProcessManager;
}

const OVERVIEW_URL = "/bots/schedules/overview";

describe("GET /bots/schedules/overview", () => {
  // Auth coverage: OVERVIEW_URL starts with /bots which is in API_PREFIXES
  // (verified by auth.test.ts "API fetch to /bots without auth → 401").
  // No separate auth test needed here — route-level tests use bare Fastify
  // without the auth hook, which is the standard pattern in this codebase.
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it("returns empty array when no bots exist", async () => {
    const pm = createMockPm([]);
    app = Fastify();
    registerScheduleOverviewRoutes(app, pm, "local");
    await app.ready();

    const res = await app.inject({ method: "GET", url: OVERVIEW_URL });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("aggregates schedules from multiple running bots", async () => {
    const pm = createMockPm([
      { name: "alice", state: "running" },
      { name: "bob", state: "running" },
      { name: "charlie", state: "stopped" },
    ]);
    app = Fastify();
    registerScheduleOverviewRoutes(app, pm, "node-1");
    await app.ready();

    mockList.mockImplementation(async (_pm, name) => {
      if (name === "alice") {
        return [
          { id: "health", trigger: { type: "interval", every: "5m", intervalMs: 300000 }, prompt: "Check health", paused: false },
        ] as never;
      }
      return [
        { id: "backup", trigger: { type: "interval", every: "1h", intervalMs: 3600000 }, prompt: "Run backup" },
      ] as never;
    });

    const res = await app.inject({ method: "GET", url: OVERVIEW_URL });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
    expect(body[0]).toEqual({
      botName: "alice",
      node: "node-1",
      scheduleId: "health",
      every: "5m",
      prompt: "Check health",
      paused: false,
    });
    expect(body[1]).toEqual({
      botName: "bob",
      node: "node-1",
      scheduleId: "backup",
      every: "1h",
      prompt: "Run backup",
      paused: false,
    });
    // Should not query stopped bot
    expect(mockList).toHaveBeenCalledTimes(2);
  });

  it("handles per-bot fetch failures gracefully and sets partial header", async () => {
    const pm = createMockPm([
      { name: "alice", state: "running" },
      { name: "broken", state: "running" },
    ]);
    app = Fastify({ logger: false });
    registerScheduleOverviewRoutes(app, pm, "local");
    await app.ready();

    mockList.mockImplementation(async (_pm, name) => {
      if (name === "broken") throw new Error("bot crashed");
      return [
        { id: "task1", trigger: { type: "interval", every: "10m", intervalMs: 600000 }, prompt: "Do stuff" },
      ] as never;
    });

    const res = await app.inject({ method: "GET", url: OVERVIEW_URL });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Only alice's schedule should be returned; broken bot is skipped with warning
    expect(body).toHaveLength(1);
    expect(body[0].botName).toBe("alice");
    // Partial failure header should be set
    expect(res.headers["x-partial-failures"]).toBe("1");
  });

  it("does not set partial-failure header when all bots succeed", async () => {
    const pm = createMockPm([{ name: "alice", state: "running" }]);
    app = Fastify();
    registerScheduleOverviewRoutes(app, pm, "local");
    await app.ready();

    mockList.mockResolvedValue([
      { id: "t1", trigger: { type: "interval", every: "1h", intervalMs: 3600000 }, prompt: "test" },
    ] as never);

    const res = await app.inject({ method: "GET", url: OVERVIEW_URL });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-partial-failures"]).toBeUndefined();
  });
});
