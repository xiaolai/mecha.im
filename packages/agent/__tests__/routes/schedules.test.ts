import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerScheduleRoutes } from "../../src/routes/schedules.js";
import type { ProcessManager } from "@mecha/process";

vi.mock("@mecha/service", () => ({
  botScheduleList: vi.fn(),
  botScheduleAdd: vi.fn(),
  botScheduleRemove: vi.fn(),
  botSchedulePause: vi.fn(),
  botScheduleResume: vi.fn(),
  botScheduleRun: vi.fn(),
  botScheduleHistory: vi.fn(),
}));

import {
  botScheduleList,
  botScheduleAdd,
  botScheduleRemove,
  botSchedulePause,
  botScheduleResume,
  botScheduleRun,
  botScheduleHistory,
} from "@mecha/service";

const mockList = vi.mocked(botScheduleList);
const mockAdd = vi.mocked(botScheduleAdd);
const mockRemove = vi.mocked(botScheduleRemove);
const mockPause = vi.mocked(botSchedulePause);
const mockResume = vi.mocked(botScheduleResume);
const mockRun = vi.mocked(botScheduleRun);
const mockHistory = vi.mocked(botScheduleHistory);

function createMockPm(running = true): ProcessManager {
  return {
    spawn: vi.fn(),
    get: vi.fn().mockImplementation((name: string) =>
      running ? { name, state: "running", workspacePath: "/ws" } : undefined,
    ),
    list: vi.fn().mockReturnValue([]),
    stop: vi.fn(),
    kill: vi.fn(),
    logs: vi.fn(),
    getPortAndToken: vi.fn(),
    onEvent: vi.fn().mockReturnValue(() => {}),
  } as unknown as ProcessManager;
}

describe("agent schedule routes", () => {
  let app: FastifyInstance;
  let pm: ProcessManager;

  beforeEach(async () => {
    pm = createMockPm();
    app = Fastify();
    registerScheduleRoutes(app, pm);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  describe("GET /bots/:name/schedules", () => {
    it("returns schedule list", async () => {
      const schedules = [{ id: "health", trigger: { type: "interval", every: "5m", intervalMs: 300000 }, prompt: "Check health" }];
      mockList.mockResolvedValue(schedules as never);
      const res = await app.inject({ method: "GET", url: "/bots/alice/schedules" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(schedules);
    });

    it("returns 400 for invalid bot name", async () => {
      const res = await app.inject({ method: "GET", url: "/bots/IN VALID/schedules" });
      expect(res.statusCode).toBe(400);
    });

    it("returns 404 when bot not found", async () => {
      // Use a separate app/pm to avoid leaking the shared instance
      const localPm = createMockPm(false);
      const localApp = Fastify();
      registerScheduleRoutes(localApp, localPm);
      await localApp.ready();
      try {
        const res = await localApp.inject({ method: "GET", url: "/bots/ghost/schedules" });
        expect(res.statusCode).toBe(404);
      } finally {
        await localApp.close();
      }
    });
  });

  describe("POST /bots/:name/schedules", () => {
    it("adds a schedule", async () => {
      mockAdd.mockResolvedValue(undefined);
      const res = await app.inject({
        method: "POST",
        url: "/bots/alice/schedules",
        payload: { id: "health", every: "5m", prompt: "Check health" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
      expect(mockAdd).toHaveBeenCalledWith(pm, "alice", { id: "health", every: "5m", prompt: "Check health" });
    });

    it("returns 400 when missing fields", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/bots/alice/schedules",
        payload: { id: "health" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("Missing required fields");
    });
  });

  describe("DELETE /bots/:name/schedules/:scheduleId", () => {
    it("removes a schedule", async () => {
      mockRemove.mockResolvedValue(undefined);
      const res = await app.inject({ method: "DELETE", url: "/bots/alice/schedules/health" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
      expect(mockRemove).toHaveBeenCalledWith(pm, "alice", "health");
    });
  });

  describe("POST /bots/:name/schedules/:scheduleId/pause", () => {
    it("pauses a schedule", async () => {
      mockPause.mockResolvedValue(undefined);
      const res = await app.inject({ method: "POST", url: "/bots/alice/schedules/health/pause" });
      expect(res.statusCode).toBe(200);
      expect(mockPause).toHaveBeenCalledWith(pm, "alice", "health");
    });
  });

  describe("POST /bots/:name/schedules/:scheduleId/resume", () => {
    it("resumes a schedule", async () => {
      mockResume.mockResolvedValue(undefined);
      const res = await app.inject({ method: "POST", url: "/bots/alice/schedules/health/resume" });
      expect(res.statusCode).toBe(200);
      expect(mockResume).toHaveBeenCalledWith(pm, "alice", "health");
    });
  });

  describe("POST /bots/:name/schedules/:scheduleId/run", () => {
    it("runs a schedule immediately", async () => {
      const result = { scheduleId: "health", startedAt: "2025-01-01T00:00:00Z", completedAt: "2025-01-01T00:00:01Z", durationMs: 1000, outcome: "success" };
      mockRun.mockResolvedValue(result as never);
      const res = await app.inject({ method: "POST", url: "/bots/alice/schedules/health/run" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(result);
    });
  });

  describe("GET /bots/:name/schedules/:scheduleId/history", () => {
    it("returns run history with limit", async () => {
      const history = [{ scheduleId: "health", startedAt: "2025-01-01T00:00:00Z", completedAt: "2025-01-01T00:00:01Z", durationMs: 1000, outcome: "success" }];
      mockHistory.mockResolvedValue(history as never);
      const res = await app.inject({ method: "GET", url: "/bots/alice/schedules/health/history?limit=10" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(history);
      expect(mockHistory).toHaveBeenCalledWith(pm, "alice", "health", 10);
    });

    it("passes undefined limit when not specified", async () => {
      mockHistory.mockResolvedValue([]);
      const res = await app.inject({ method: "GET", url: "/bots/alice/schedules/health/history" });
      expect(res.statusCode).toBe(200);
      expect(mockHistory).toHaveBeenCalledWith(pm, "alice", "health", undefined);
    });

    it("returns 400 for non-numeric limit", async () => {
      mockHistory.mockClear();
      const res = await app.inject({ method: "GET", url: "/bots/alice/schedules/health/history?limit=abc" });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("positive integer");
      expect(mockHistory).not.toHaveBeenCalled();
    });

    it("returns 400 for negative limit", async () => {
      mockHistory.mockClear();
      const res = await app.inject({ method: "GET", url: "/bots/alice/schedules/health/history?limit=-1" });
      expect(res.statusCode).toBe(400);
      expect(mockHistory).not.toHaveBeenCalled();
    });

    it("returns 400 for non-integer limit", async () => {
      mockHistory.mockClear();
      const res = await app.inject({ method: "GET", url: "/bots/alice/schedules/health/history?limit=1.5" });
      expect(res.statusCode).toBe(400);
      expect(mockHistory).not.toHaveBeenCalled();
    });
  });
});
