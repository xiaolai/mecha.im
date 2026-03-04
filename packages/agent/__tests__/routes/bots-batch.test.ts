import { describe, it, expect, vi, afterEach } from "vitest";
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

import { batchBotAction } from "@mecha/service";
const mockBatch = vi.mocked(batchBotAction);

afterEach(() => {
  mockBatch.mockReset();
});

const ALICE: ProcessInfo = { name: "alice" as BotName, state: "running", pid: 1, port: 7700, workspacePath: "/ws" };

describe("POST /bots/batch", () => {
  it("calls batchBotAction with stop", async () => {
    mockBatch.mockResolvedValue({
      results: [{ name: "alice", status: "succeeded" }],
      summary: { succeeded: 1, skipped: 0, failed: 0 },
    });
    const app = Fastify();
    registerBotRoutes(app, makePm([ALICE]), "/tmp/mecha");
    await app.ready();

    const res = await app.inject({
      method: "POST", url: "/bots/batch",
      payload: { action: "stop" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.summary.succeeded).toBe(1);
    expect(mockBatch).toHaveBeenCalledWith(expect.objectContaining({ action: "stop" }));
    await app.close();
  });

  it("calls batchBotAction with restart and flags", async () => {
    mockBatch.mockResolvedValue({
      results: [], summary: { succeeded: 0, skipped: 0, failed: 0 },
    });
    const app = Fastify();
    registerBotRoutes(app, makePm([]), "/tmp/mecha");
    await app.ready();

    const res = await app.inject({
      method: "POST", url: "/bots/batch",
      payload: { action: "restart", force: true, idleOnly: false, dryRun: true },
    });
    expect(res.statusCode).toBe(200);
    expect(mockBatch).toHaveBeenCalledWith(expect.objectContaining({
      action: "restart", force: true, dryRun: true,
    }));
    await app.close();
  });

  it("rejects invalid action", async () => {
    const app = Fastify();
    registerBotRoutes(app, makePm([]), "/tmp/mecha");
    await app.ready();

    const res = await app.inject({
      method: "POST", url: "/bots/batch",
      payload: { action: "kill" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("action must be");
    await app.close();
  });

  it("coerces non-boolean flags to false", async () => {
    mockBatch.mockResolvedValue({
      results: [], summary: { succeeded: 0, skipped: 0, failed: 0 },
    });
    const app = Fastify();
    registerBotRoutes(app, makePm([]), "/tmp/mecha");
    await app.ready();

    const res = await app.inject({
      method: "POST", url: "/bots/batch",
      payload: { action: "stop", force: "true", idleOnly: 1, dryRun: "yes" },
    });
    expect(res.statusCode).toBe(200);
    expect(mockBatch).toHaveBeenCalledWith(expect.objectContaining({
      force: false, idleOnly: false, dryRun: false,
    }));
    await app.close();
  });

  it("returns partial failure results", async () => {
    mockBatch.mockResolvedValue({
      results: [
        { name: "alice", status: "succeeded" },
        { name: "bob", status: "failed", error: "timeout" },
      ],
      summary: { succeeded: 1, skipped: 0, failed: 1 },
    });
    const app = Fastify();
    registerBotRoutes(app, makePm([ALICE]), "/tmp/mecha");
    await app.ready();

    const res = await app.inject({
      method: "POST", url: "/bots/batch",
      payload: { action: "stop" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.summary.failed).toBe(1);
    expect(body.results).toHaveLength(2);
    await app.close();
  });
});
