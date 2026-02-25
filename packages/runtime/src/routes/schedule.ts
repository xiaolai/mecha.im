import type { FastifyInstance } from "fastify";
import type { ScheduleEngine } from "../scheduler.js";
import {
  ScheduleAddInput,
  parseInterval,
  MechaError,
  InvalidIntervalError,
} from "@mecha/core";
import { ZodError } from "zod";

function handleError(err: unknown, reply: { code: (n: number) => { send: (b: unknown) => void } }): void {
  if (err instanceof MechaError) {
    reply.code(err.statusCode).send({ error: err.message });
    return;
  }
  /* v8 ignore start -- ZodError and unexpected errors only hit via malformed requests */
  if (err instanceof ZodError) {
    reply.code(400).send({ error: err.errors[0]?.message ?? "Validation error" });
    return;
  }
  throw err;
  /* v8 ignore stop */
}

export function registerScheduleRoutes(
  app: FastifyInstance,
  engine: ScheduleEngine,
): void {
  // List schedules
  app.get("/api/schedules", async () => {
    return engine.listSchedules();
  });

  // Add schedule
  app.post("/api/schedules", async (request, reply) => {
    try {
      const input = ScheduleAddInput.parse(request.body);
      const intervalMs = parseInterval(input.every);
      if (intervalMs === undefined) {
        throw new InvalidIntervalError(input.every);
      }
      engine.addSchedule({
        id: input.id,
        trigger: { type: "interval", every: input.every, intervalMs },
        prompt: input.prompt,
      });
      reply.code(201).send({ ok: true, id: input.id });
    } catch (err) {
      handleError(err, reply);
    }
  });

  // Remove schedule
  app.delete<{ Params: { id: string } }>(
    "/api/schedules/:id",
    async (request, reply) => {
      try {
        engine.removeSchedule(request.params.id);
        reply.code(204).send();
      } catch (err) {
        handleError(err, reply);
      }
    },
  );

  // Pause schedule
  app.post<{ Params: { id: string } }>(
    "/api/schedules/:id/pause",
    async (request, reply) => {
      try {
        engine.pauseSchedule(request.params.id);
        reply.code(200).send({ ok: true });
      } catch (err) {
        handleError(err, reply);
      }
    },
  );

  // Resume schedule
  app.post<{ Params: { id: string } }>(
    "/api/schedules/:id/resume",
    async (request, reply) => {
      try {
        engine.resumeSchedule(request.params.id);
        reply.code(200).send({ ok: true });
      } catch (err) {
        handleError(err, reply);
      }
    },
  );

  // Pause all schedules
  app.post("/api/schedules/pause-all", async (_request, reply) => {
    engine.pauseSchedule();
    reply.code(200).send({ ok: true });
  });

  // Resume all schedules
  app.post("/api/schedules/resume-all", async (_request, reply) => {
    engine.resumeSchedule();
    reply.code(200).send({ ok: true });
  });

  // Trigger schedule now
  app.post<{ Params: { id: string } }>(
    "/api/schedules/:id/run",
    async (request, reply) => {
      try {
        const result = await engine.triggerNow(request.params.id);
        return result;
      } catch (err) {
        handleError(err, reply);
      }
    },
  );

  // Get run history
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    "/api/schedules/:id/history",
    async (request, reply) => {
      try {
        const rawLimit = request.query.limit ? Number(request.query.limit) : undefined;
        const limit = rawLimit !== undefined && Number.isFinite(rawLimit) && rawLimit > 0
          ? Math.floor(rawLimit)
          : undefined;
        return engine.getHistory(request.params.id, limit);
      } catch (err) {
        handleError(err, reply);
      }
    },
  );
}
