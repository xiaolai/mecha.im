import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { ProcessManager } from "@mecha/process";
import { type BotName, BotNotFoundError, BotNotRunningError } from "@mecha/core";
import {
  botScheduleAdd,
  botScheduleRemove,
  botScheduleList,
  botSchedulePause,
  botScheduleResume,
  botScheduleRun,
  botScheduleHistory,
} from "../src/schedule.js";

const BOT = "test" as BotName;
const TOKEN = "test-token";

function createMockPM(port: number): ProcessManager {
  return {
    spawn: vi.fn(),
    get: vi.fn().mockReturnValue({ name: BOT, state: "running" }),
    list: vi.fn().mockReturnValue([]),
    stop: vi.fn(),
    kill: vi.fn(),
    logs: vi.fn(),
    getPortAndToken: vi.fn().mockReturnValue({ port, token: TOKEN }),
    onEvent: vi.fn().mockReturnValue(() => {}),
  } as ProcessManager;
}

describe("botSchedule*", () => {
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

  it("botScheduleAdd adds a schedule", async () => {
    await botScheduleAdd(pm, BOT, { id: "test-sched", every: "5m", prompt: "Hello" });
    expect(schedules).toHaveLength(1);
    expect(schedules[0]!.id).toBe("test-sched");
  });

  it("botScheduleAdd rejects invalid interval client-side", async () => {
    await expect(
      botScheduleAdd(pm, BOT, { id: "bad", every: "2s", prompt: "test" }),
    ).rejects.toThrow("Invalid interval");
  });

  it("botScheduleAdd throws on server error", async () => {
    await botScheduleAdd(pm, BOT, { id: "first", every: "5m", prompt: "x" });
    await expect(
      botScheduleAdd(pm, BOT, { id: "first", every: "5m", prompt: "y" }),
    ).rejects.toThrow("already exists");
  });

  it("botScheduleList lists schedules", async () => {
    await botScheduleAdd(pm, BOT, { id: "a", every: "5m", prompt: "x" });
    const list = await botScheduleList(pm, BOT);
    expect(list).toHaveLength(1);
  });

  it("botScheduleRemove removes schedule", async () => {
    await botScheduleAdd(pm, BOT, { id: "rm", every: "5m", prompt: "x" });
    await botScheduleRemove(pm, BOT, "rm");
    expect(schedules).toHaveLength(0);
  });

  it("botScheduleRemove throws for unknown", async () => {
    await expect(botScheduleRemove(pm, BOT, "nope")).rejects.toThrow();
  });

  it("botSchedulePause pauses schedule", async () => {
    await botScheduleAdd(pm, BOT, { id: "p", every: "5m", prompt: "x" });
    await botSchedulePause(pm, BOT, "p");
    expect(schedules[0]!.paused).toBe(true);
  });

  it("botSchedulePause pauses all", async () => {
    await botScheduleAdd(pm, BOT, { id: "a", every: "5m", prompt: "x" });
    await botScheduleAdd(pm, BOT, { id: "b", every: "10m", prompt: "y" });
    await botSchedulePause(pm, BOT);
    expect(schedules.every((s) => s.paused)).toBe(true);
  });

  it("botScheduleResume resumes schedule", async () => {
    await botScheduleAdd(pm, BOT, { id: "r", every: "5m", prompt: "x" });
    await botSchedulePause(pm, BOT, "r");
    await botScheduleResume(pm, BOT, "r");
    expect(schedules[0]!.paused).toBe(false);
  });

  it("botScheduleResume resumes all schedules", async () => {
    await botScheduleAdd(pm, BOT, { id: "r1", every: "5m", prompt: "x" });
    await botScheduleAdd(pm, BOT, { id: "r2", every: "10m", prompt: "y" });
    await botSchedulePause(pm, BOT);
    await botScheduleResume(pm, BOT);
    expect(schedules.every((s) => !s.paused)).toBe(true);
  });

  it("botScheduleRun triggers immediate run", async () => {
    await botScheduleAdd(pm, BOT, { id: "run", every: "5m", prompt: "x" });
    const result = await botScheduleRun(pm, BOT, "run");
    expect(result.outcome).toBe("success");
    expect(result.durationMs).toBe(100);
  });

  it("botScheduleRun throws for unknown", async () => {
    await expect(botScheduleRun(pm, BOT, "nope")).rejects.toThrow();
  });

  it("botScheduleHistory returns history", async () => {
    await botScheduleAdd(pm, BOT, { id: "h", every: "5m", prompt: "x" });
    await botScheduleRun(pm, BOT, "h");
    const hist = await botScheduleHistory(pm, BOT, "h");
    expect(hist).toHaveLength(1);
  });

  it("botScheduleHistory passes limit parameter", async () => {
    await botScheduleAdd(pm, BOT, { id: "hl", every: "5m", prompt: "x" });
    await botScheduleRun(pm, BOT, "hl");
    const hist = await botScheduleHistory(pm, BOT, "hl", 5);
    expect(hist).toHaveLength(1);
  });

  it("botScheduleHistory throws for unknown schedule", async () => {
    await expect(botScheduleHistory(pm, BOT, "ghost")).rejects.toThrow();
  });

  it("throws BotNotFoundError for unknown bot", async () => {
    const badPm = {
      ...pm,
      getPortAndToken: vi.fn().mockReturnValue(undefined),
      get: vi.fn().mockReturnValue(undefined),
    } as unknown as ProcessManager;
    await expect(botScheduleList(badPm, BOT)).rejects.toThrow(BotNotFoundError);
  });

  it("throws BotNotRunningError for stopped bot", async () => {
    const badPm = {
      ...pm,
      getPortAndToken: vi.fn().mockReturnValue(undefined),
      get: vi.fn().mockReturnValue({ name: BOT, state: "stopped" }),
    } as unknown as ProcessManager;
    await expect(botScheduleList(badPm, BOT)).rejects.toThrow(BotNotRunningError);
  });
});
