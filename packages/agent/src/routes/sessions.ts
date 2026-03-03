import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { type CasaName, isValidName } from "@mecha/core";
import type { ProcessManager } from "@mecha/process";
import { casaSessionList, casaSessionGet, casaSessionDelete } from "@mecha/service";

/** Validate + resolve CASA from route params. Returns casaName or sends error reply. */
function resolveCasa(
  pm: ProcessManager,
  request: FastifyRequest<{ Params: { name: string } }>,
  reply: FastifyReply,
): CasaName | null {
  const name = request.params.name;
  if (!isValidName(name)) {
    reply.code(400).send({ error: `Invalid CASA name: ${name}` });
    return null;
  }
  const casaName = name as CasaName;
  if (!pm.get(casaName)) {
    reply.code(404).send({ error: `CASA not found: ${casaName}` });
    return null;
  }
  return casaName;
}

export function registerSessionRoutes(app: FastifyInstance, pm: ProcessManager): void {
  app.get("/casas/:name/sessions", async (request: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
    const casaName = resolveCasa(pm, request, reply);
    if (!casaName) return;
    try {
      return await casaSessionList(pm, casaName);
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
    const casaName = resolveCasa(pm, request as FastifyRequest<{ Params: { name: string } }>, reply);
    if (!casaName) return;
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

  app.delete("/casas/:name/sessions/:id", async (
    request: FastifyRequest<{ Params: { name: string; id: string } }>,
    reply: FastifyReply,
  ) => {
    const casaName = resolveCasa(pm, request as FastifyRequest<{ Params: { name: string } }>, reply);
    if (!casaName) return;
    try {
      const deleted = await casaSessionDelete(pm, casaName, request.params.id);
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
