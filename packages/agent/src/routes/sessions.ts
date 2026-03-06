import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { type BotName, isValidName } from "@mecha/core";
import type { ProcessManager } from "@mecha/process";
import { botSessionList, botSessionGet, botSessionDelete } from "@mecha/service";

/** Validate + resolve bot from route params. Returns botName or sends error reply. */
function resolveBot(
  pm: ProcessManager,
  request: FastifyRequest<{ Params: { name: string } }>,
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

/** Register bot session routes: list, get, and delete sessions for a bot. */
export function registerSessionRoutes(app: FastifyInstance, pm: ProcessManager): void {
  app.get("/bots/:name/sessions", async (request: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
    const botName = resolveBot(pm, request, reply);
    if (!botName) return;
    try {
      return await botSessionList(pm, botName);
    /* v8 ignore start -- non-Error throw is defensive */
    } catch (err) {
      reply.code(502).send({ error: `Failed to fetch sessions: ${err instanceof Error ? err.message : String(err)}` });
    }
    /* v8 ignore stop */
  });

  app.get("/bots/:name/sessions/:id", async (
    request: FastifyRequest<{ Params: { name: string; id: string } }>,
    reply: FastifyReply,
  ) => {
    const botName = resolveBot(pm, request as FastifyRequest<{ Params: { name: string } }>, reply);
    if (!botName) return;
    try {
      const session = await botSessionGet(pm, botName, request.params.id);
      if (!session) {
        reply.code(404).send({ error: `Session not found: ${request.params.id}` });
        return;
      }
      return session;
    /* v8 ignore start -- non-Error throw is defensive */
    } catch (err) {
      reply.code(502).send({ error: `Failed to fetch session: ${err instanceof Error ? err.message : String(err)}` });
    }
    /* v8 ignore stop */
  });

  app.delete("/bots/:name/sessions/:id", async (
    request: FastifyRequest<{ Params: { name: string; id: string } }>,
    reply: FastifyReply,
  ) => {
    const botName = resolveBot(pm, request as FastifyRequest<{ Params: { name: string } }>, reply);
    if (!botName) return;
    try {
      const deleted = await botSessionDelete(pm, botName, request.params.id);
      if (!deleted) {
        reply.code(404).send({ error: `Session not found: ${request.params.id}` });
        return;
      }
      return { ok: true };
    /* v8 ignore start -- non-Error throw is defensive */
    } catch (err) {
      reply.code(502).send({ error: `Failed to delete session: ${err instanceof Error ? err.message : String(err)}` });
    }
    /* v8 ignore stop */
  });
}
