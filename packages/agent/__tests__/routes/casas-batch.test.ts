import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify from "fastify";
import { registerCasaRoutes } from "../../src/routes/casas.js";
import type { CasaName } from "@mecha/core";
import type { ProcessInfo } from "@mecha/process";
import { makePm } from "../../../service/__tests__/test-utils.js";

vi.mock("@mecha/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mecha/service")>();
  return {
    ...actual,
    batchCasaAction: vi.fn(),
    getCachedSnapshot: vi.fn().mockReturnValue(null),
    checkCasaBusy: vi.fn().mockResolvedValue({ busy: false, activeSessions: 0 }),
  };
});

import { batchCasaAction } from "@mecha/service";
const mockBatch = vi.mocked(batchCasaAction);

afterEach(() => {
  mockBatch.mockReset();
});

const ALICE: ProcessInfo = { name: "alice" as CasaName, state: "running", pid: 1, port: 7700, workspacePath: "/ws" };

describe("POST /casas/batch", () => {
  it("calls batchCasaAction with stop", async () => {
    mockBatch.mockResolvedValue({
      results: [{ name: "alice", status: "succeeded" }],
      summary: { succeeded: 1, skipped: 0, failed: 0 },
    });
    const app = Fastify();
    registerCasaRoutes(app, makePm([ALICE]), "/tmp/mecha");
    await app.ready();

    const res = await app.inject({
      method: "POST", url: "/casas/batch",
      payload: { action: "stop" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.summary.succeeded).toBe(1);
    expect(mockBatch).toHaveBeenCalledWith(expect.objectContaining({ action: "stop" }));
    await app.close();
  });

  it("calls batchCasaAction with restart and flags", async () => {
    mockBatch.mockResolvedValue({
      results: [], summary: { succeeded: 0, skipped: 0, failed: 0 },
    });
    const app = Fastify();
    registerCasaRoutes(app, makePm([]), "/tmp/mecha");
    await app.ready();

    const res = await app.inject({
      method: "POST", url: "/casas/batch",
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
    registerCasaRoutes(app, makePm([]), "/tmp/mecha");
    await app.ready();

    const res = await app.inject({
      method: "POST", url: "/casas/batch",
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
    registerCasaRoutes(app, makePm([]), "/tmp/mecha");
    await app.ready();

    const res = await app.inject({
      method: "POST", url: "/casas/batch",
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
    registerCasaRoutes(app, makePm([ALICE]), "/tmp/mecha");
    await app.ready();

    const res = await app.inject({
      method: "POST", url: "/casas/batch",
      payload: { action: "stop" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.summary.failed).toBe(1);
    expect(body.results).toHaveLength(2);
    await app.close();
  });
});
