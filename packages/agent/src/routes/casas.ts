import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { type CasaName, isValidName } from "@mecha/core";
import type { ProcessManager } from "@mecha/process";

function validateName(name: string, reply: FastifyReply): CasaName | null {
  if (!isValidName(name)) {
    reply.code(400).send({ error: `Invalid CASA name: ${name}` });
    return null;
  }
  return name as CasaName;
}

export function registerCasaRoutes(app: FastifyInstance, pm: ProcessManager): void {
  app.get("/casas", async () => {
    const list = pm.list();
    return list.map((p) => ({
      name: p.name,
      state: p.state,
      port: p.port,
    }));
  });

  app.get("/casas/:name/status", async (request: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
    const casaName = validateName(request.params.name, reply);
    if (!casaName) return;
    const info = pm.get(casaName);
    if (!info) {
      reply.code(404).send({ error: `CASA not found: ${casaName}` });
      return;
    }
    return { name: info.name, state: info.state, port: info.port };
  });

  app.post("/casas/:name/stop", async (request: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
    const casaName = validateName(request.params.name, reply);
    if (!casaName) return;
    const info = pm.get(casaName);
    if (!info) {
      reply.code(404).send({ error: `CASA not found: ${casaName}` });
      return;
    }
    if (info.state !== "running") {
      reply.code(403).send({ error: "Not running" });
      return;
    }
    await pm.stop(casaName);
    return { ok: true };
  });

  app.post("/casas/:name/kill", async (request: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
    const casaName = validateName(request.params.name, reply);
    if (!casaName) return;
    const info = pm.get(casaName);
    if (!info) {
      reply.code(404).send({ error: `CASA not found: ${casaName}` });
      return;
    }
    await pm.kill(casaName);
    return { ok: true };
  });

  app.post("/casas", async (request: FastifyRequest<{ Body: { name?: string; workspacePath?: string } }>, reply: FastifyReply) => {
    /* v8 ignore start -- Fastify always parses body for POST */
    const body = request.body ?? {};
    /* v8 ignore stop */
    const rawName = body.name;
    if (!rawName || !isValidName(rawName)) {
      reply.code(400).send({ error: `Invalid CASA name: ${rawName ?? "(missing)"}` });
      return;
    }
    if (!body.workspacePath) {
      reply.code(400).send({ error: "Missing workspacePath" });
      return;
    }
    const casaName = rawName as CasaName;
    const existing = pm.get(casaName);
    if (existing) {
      reply.code(409).send({ error: `CASA already exists: ${casaName}` });
      return;
    }
    const result = await pm.spawn({ name: casaName, workspacePath: body.workspacePath });
    return { ok: true, name: casaName, port: result.port };
  });
}
