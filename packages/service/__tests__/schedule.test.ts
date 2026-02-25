import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { ProcessManager } from "@mecha/process";
import { type CasaName, CasaNotFoundError, CasaNotRunningError } from "@mecha/core";
import {
  casaScheduleAdd,
  casaScheduleRemove,
  casaScheduleList,
  casaSchedulePause,
  casaScheduleResume,
  casaScheduleRun,
  casaScheduleHistory,
} from "../src/schedule.js";

const CASA = "test" as CasaName;
const TOKEN = "test-token";

function createMockPM(port: number): ProcessManager {
  return {
    spawn: vi.fn(),
    get: vi.fn().mockReturnValue({ name: CASA, state: "running" }),
    list: vi.fn().mockReturnValue([]),
    stop: vi.fn(),
    kill: vi.fn(),
    logs: vi.fn(),
    getPortAndToken: vi.fn().mockReturnValue({ port, token: TOKEN }),
    onEvent: vi.fn().mockReturnValue(() => {}),
  } as ProcessManager;
}

describe("casaSchedule*", () => {
  let app: FastifyInstance;
  let port: number;
  let pm: ProcessManager;

  // In-memory schedule store for the mock server
  let schedules: Array<{ id: string; trigger: { type: string; every: string; intervalMs: number }; prompt: string; paused?: boolean }>;
  let history: Array<{ scheduleId: string; startedAt: string; completedAt: string; durationMs: number; outcome: string }>;

  beforeEach(async () => {
    schedules = [];
    history = [];

    app = Fastify();

    app.get("/api/schedules", async () => schedules);

    app.post("/api/schedules", async (req, reply) => {
      const body = req.body as { id: string; every: string; prompt: string };
      if (schedules.find((s) => s.id === body.id)) {
        reply.code(409).send({ error: `Schedule "${body.id}" already exists` });
        return;
      }
      schedules.push({
        id: body.id,
        trigger: { type: "interval", every: body.every, intervalMs: 300_000 },
        prompt: body.prompt,
      });
      reply.code(201).send({ ok: true });
    });

    app.delete<{ Params: { id: string } }>("/api/schedules/:id", async (req, reply) => {
      const idx = schedules.findIndex((s) => s.id === req.params.id);
      if (idx === -1) {
        reply.code(404).send({ error: "Not found" });
        return;
      }
      schedules.splice(idx, 1);
      reply.code(204).send();
    });

    app.post<{ Params: { id: string } }>("/api/schedules/:id/pause", async (req, reply) => {
      const s = schedules.find((s) => s.id === req.params.id);
      if (!s) { reply.code(404).send({ error: "Not found" }); return; }
      s.paused = true;
      reply.send({ ok: true });
    });

    app.post<{ Params: { id: string } }>("/api/schedules/:id/resume", async (req, reply) => {
      const s = schedules.find((s) => s.id === req.params.id);
      if (!s) { reply.code(404).send({ error: "Not found" }); return; }
      s.paused = false;
      reply.send({ ok: true });
    });

    app.post("/api/schedules/pause-all", async (_req, reply) => {
      for (const s of schedules) s.paused = true;
      reply.send({ ok: true });
    });

    app.post("/api/schedules/resume-all", async (_req, reply) => {
      for (const s of schedules) s.paused = false;
      reply.send({ ok: true });
    });

    app.post<{ Params: { id: string } }>("/api/schedules/:id/run", async (req, reply) => {
      const s = schedules.find((s) => s.id === req.params.id);
      if (!s) { reply.code(404).send({ error: "Not found" }); return; }
      const result = {
        scheduleId: s.id,
        startedAt: "2026-02-25T10:00:00Z",
        completedAt: "2026-02-25T10:00:01Z",
        durationMs: 100,
        outcome: "success",
      };
      history.push(result);
      reply.send(result);
    });

    app.get<{ Params: { id: string } }>("/api/schedules/:id/history", async (req, reply) => {
      const s = schedules.find((s) => s.id === req.params.id);
      if (!s) { reply.code(404).send({ error: "Not found" }); return; }
      return history;
    });

    await app.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.server.address();
    port = typeof addr === "object" && addr ? addr.port : 0;
    pm = createMockPM(port);
  });

  afterEach(async () => {
    await app.close();
  });

  it("casaScheduleAdd adds a schedule", async () => {
    await casaScheduleAdd(pm, CASA, { id: "test-sched", every: "5m", prompt: "Hello" });
    expect(schedules).toHaveLength(1);
    expect(schedules[0]!.id).toBe("test-sched");
  });

  it("casaScheduleAdd rejects invalid interval client-side", async () => {
    await expect(
      casaScheduleAdd(pm, CASA, { id: "bad", every: "2s", prompt: "test" }),
    ).rejects.toThrow("Invalid interval");
  });

  it("casaScheduleAdd throws on server error", async () => {
    await casaScheduleAdd(pm, CASA, { id: "first", every: "5m", prompt: "x" });
    await expect(
      casaScheduleAdd(pm, CASA, { id: "first", every: "5m", prompt: "y" }),
    ).rejects.toThrow("already exists");
  });

  it("casaScheduleList lists schedules", async () => {
    await casaScheduleAdd(pm, CASA, { id: "a", every: "5m", prompt: "x" });
    const list = await casaScheduleList(pm, CASA);
    expect(list).toHaveLength(1);
  });

  it("casaScheduleRemove removes schedule", async () => {
    await casaScheduleAdd(pm, CASA, { id: "rm", every: "5m", prompt: "x" });
    await casaScheduleRemove(pm, CASA, "rm");
    expect(schedules).toHaveLength(0);
  });

  it("casaScheduleRemove throws for unknown", async () => {
    await expect(casaScheduleRemove(pm, CASA, "nope")).rejects.toThrow();
  });

  it("casaSchedulePause pauses schedule", async () => {
    await casaScheduleAdd(pm, CASA, { id: "p", every: "5m", prompt: "x" });
    await casaSchedulePause(pm, CASA, "p");
    expect(schedules[0]!.paused).toBe(true);
  });

  it("casaSchedulePause pauses all", async () => {
    await casaScheduleAdd(pm, CASA, { id: "a", every: "5m", prompt: "x" });
    await casaScheduleAdd(pm, CASA, { id: "b", every: "10m", prompt: "y" });
    await casaSchedulePause(pm, CASA);
    expect(schedules.every((s) => s.paused)).toBe(true);
  });

  it("casaScheduleResume resumes schedule", async () => {
    await casaScheduleAdd(pm, CASA, { id: "r", every: "5m", prompt: "x" });
    await casaSchedulePause(pm, CASA, "r");
    await casaScheduleResume(pm, CASA, "r");
    expect(schedules[0]!.paused).toBe(false);
  });

  it("casaScheduleResume resumes all schedules", async () => {
    await casaScheduleAdd(pm, CASA, { id: "r1", every: "5m", prompt: "x" });
    await casaScheduleAdd(pm, CASA, { id: "r2", every: "10m", prompt: "y" });
    await casaSchedulePause(pm, CASA);
    await casaScheduleResume(pm, CASA);
    expect(schedules.every((s) => !s.paused)).toBe(true);
  });

  it("casaScheduleRun triggers immediate run", async () => {
    await casaScheduleAdd(pm, CASA, { id: "run", every: "5m", prompt: "x" });
    const result = await casaScheduleRun(pm, CASA, "run");
    expect(result.outcome).toBe("success");
    expect(result.durationMs).toBe(100);
  });

  it("casaScheduleRun throws for unknown", async () => {
    await expect(casaScheduleRun(pm, CASA, "nope")).rejects.toThrow();
  });

  it("casaScheduleHistory returns history", async () => {
    await casaScheduleAdd(pm, CASA, { id: "h", every: "5m", prompt: "x" });
    await casaScheduleRun(pm, CASA, "h");
    const hist = await casaScheduleHistory(pm, CASA, "h");
    expect(hist).toHaveLength(1);
  });

  it("casaScheduleHistory passes limit parameter", async () => {
    await casaScheduleAdd(pm, CASA, { id: "hl", every: "5m", prompt: "x" });
    await casaScheduleRun(pm, CASA, "hl");
    const hist = await casaScheduleHistory(pm, CASA, "hl", 5);
    expect(hist).toHaveLength(1);
  });

  it("casaScheduleHistory throws for unknown schedule", async () => {
    await expect(casaScheduleHistory(pm, CASA, "ghost")).rejects.toThrow();
  });

  it("throws CasaNotFoundError for unknown CASA", async () => {
    const badPm = {
      ...pm,
      getPortAndToken: vi.fn().mockReturnValue(undefined),
      get: vi.fn().mockReturnValue(undefined),
    } as unknown as ProcessManager;
    await expect(casaScheduleList(badPm, CASA)).rejects.toThrow(CasaNotFoundError);
  });

  it("throws CasaNotRunningError for stopped CASA", async () => {
    const badPm = {
      ...pm,
      getPortAndToken: vi.fn().mockReturnValue(undefined),
      get: vi.fn().mockReturnValue({ name: CASA, state: "stopped" }),
    } as unknown as ProcessManager;
    await expect(casaScheduleList(badPm, CASA)).rejects.toThrow(CasaNotRunningError);
  });
});
