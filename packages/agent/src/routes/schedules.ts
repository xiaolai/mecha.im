import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { type BotName, isValidName } from "@mecha/core";
import type { ProcessManager } from "@mecha/process";
import {
  botScheduleList,
  botScheduleAdd,
  botScheduleRemove,
  botSchedulePause,
  botScheduleResume,
  botScheduleRun,
  botScheduleHistory,
} from "@mecha/service";

type NameParams = { Params: { name: string } };
type NameIdParams = { Params: { name: string; scheduleId: string } };

function resolveBot(
  pm: ProcessManager,
  request: FastifyRequest<NameParams>,
  reply: FastifyReply,
): BotName | null {
  const name = request.params.name;
  if (!isValidName(name)) {
    reply.code(400).send({ error: `Invalid bot name: ${name}` });
    return null;
  }
  const botName = name as BotName;
  if (!pm.get(botName)) {
    reply.code(404).send({ error: `bot not found: ${botName}` });
    return null;
  }
  return botName;
}

/** Register per-bot schedule CRUD routes: list, add, remove, pause, resume, run, and history. */
export function registerScheduleRoutes(app: FastifyInstance, pm: ProcessManager): void {
  app.get("/bots/:name/schedules", async (request: FastifyRequest<NameParams>, reply: FastifyReply) => {
    const botName = resolveBot(pm, request, reply);
    if (!botName) return;
    try {
      return await botScheduleList(pm, botName);
    /* v8 ignore start -- non-MechaError throw is defensive */
    } catch (err) {
      reply.code(502).send({ error: `Failed to list schedules: ${err instanceof Error ? err.message : String(err)}` });
    }
    /* v8 ignore stop */
  });

  app.post("/bots/:name/schedules", async (request: FastifyRequest<NameParams>, reply: FastifyReply) => {
    const botName = resolveBot(pm, request, reply);
    if (!botName) return;
    const body = (request.body ?? {}) as { id?: string; every?: string; prompt?: string };
    if (!body.id || !body.every || !body.prompt) {
      reply.code(400).send({ error: "Missing required fields: id, every, prompt" });
      return;
    }
    await botScheduleAdd(pm, botName, { id: body.id, every: body.every, prompt: body.prompt });
    return { ok: true };
  });

  app.delete("/bots/:name/schedules/:scheduleId", async (request: FastifyRequest<NameIdParams>, reply: FastifyReply) => {
    const botName = resolveBot(pm, request as unknown as FastifyRequest<NameParams>, reply);
    if (!botName) return;
    await botScheduleRemove(pm, botName, request.params.scheduleId);
    return { ok: true };
  });

  app.post("/bots/:name/schedules/:scheduleId/pause", async (request: FastifyRequest<NameIdParams>, reply: FastifyReply) => {
    const botName = resolveBot(pm, request as unknown as FastifyRequest<NameParams>, reply);
    if (!botName) return;
    await botSchedulePause(pm, botName, request.params.scheduleId);
    return { ok: true };
  });

  app.post("/bots/:name/schedules/:scheduleId/resume", async (request: FastifyRequest<NameIdParams>, reply: FastifyReply) => {
    const botName = resolveBot(pm, request as unknown as FastifyRequest<NameParams>, reply);
    if (!botName) return;
    await botScheduleResume(pm, botName, request.params.scheduleId);
    return { ok: true };
  });

  app.post("/bots/:name/schedules/:scheduleId/run", async (request: FastifyRequest<NameIdParams>, reply: FastifyReply) => {
    const botName = resolveBot(pm, request as unknown as FastifyRequest<NameParams>, reply);
    if (!botName) return;
    return await botScheduleRun(pm, botName, request.params.scheduleId);
  });

  app.get("/bots/:name/schedules/:scheduleId/history", async (request: FastifyRequest<NameIdParams & { Querystring: { limit?: string } }>, reply: FastifyReply) => {
    const botName = resolveBot(pm, request as unknown as FastifyRequest<NameParams>, reply);
    if (!botName) return;
    let limit: number | undefined;
    if (request.query?.limit !== undefined) {
      const parsed = Number(request.query.limit);
      if (!Number.isInteger(parsed) || parsed < 1) {
        reply.code(400).send({ error: "limit must be a positive integer" });
        return;
      }
      limit = parsed;
    }
    return await botScheduleHistory(pm, botName, request.params.scheduleId, limit);
  });
}
