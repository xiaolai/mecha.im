import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { type CasaName, isValidName } from "@mecha/core";
import type { ProcessManager } from "@mecha/process";

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
    const name = request.params.name;
    if (!isValidName(name)) {
      reply.code(400).send({ error: `Invalid CASA name: ${name}` });
      return;
    }
    const info = pm.get(name as CasaName);
    if (!info) {
      reply.code(404).send({ error: `CASA not found: ${name}` });
      return;
    }
    return { name: info.name, state: info.state, port: info.port };
  });
}
