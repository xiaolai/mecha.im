import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { type CasaName, isValidName } from "@mecha/core";
import type { ProcessManager } from "@mecha/process";
import { casaSessionList, casaSessionGet } from "@mecha/service";

export function registerSessionRoutes(app: FastifyInstance, pm: ProcessManager): void {
  app.get("/casas/:name/sessions", async (request: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
    const name = request.params.name;
    if (!isValidName(name)) {
      reply.code(400).send({ error: `Invalid CASA name: ${name}` });
      return;
    }
    const casaName = name as CasaName;
    const info = pm.get(casaName);
    if (!info) {
      reply.code(404).send({ error: `CASA not found: ${casaName}` });
      return;
    }
    try {
      const sessions = await casaSessionList(pm, casaName);
      return sessions;
    /* v8 ignore start -- non-Error throw is defensive */
    } catch (err) {
      reply.code(502).send({ error: `Failed to fetch sessions: ${err instanceof Error ? err.message : String(err)}` });
    }
    /* v8 ignore stop */
  });

  app.get("/casas/:name/sessions/:id", async (
    request: FastifyRequest<{ Params: { name: string; id: string } }>,
    reply: FastifyReply,
  ) => {
    const name = request.params.name;
    if (!isValidName(name)) {
      reply.code(400).send({ error: `Invalid CASA name: ${name}` });
      return;
    }
    const casaName = name as CasaName;
    const info = pm.get(casaName);
    if (!info) {
      reply.code(404).send({ error: `CASA not found: ${casaName}` });
      return;
    }
    try {
      const session = await casaSessionGet(pm, casaName, request.params.id);
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
}
