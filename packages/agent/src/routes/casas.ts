import type { FastifyInstance, FastifyRequest } from "fastify";
import type { CasaName } from "@mecha/core";
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

  app.get("/casas/:name/status", async (request: FastifyRequest<{ Params: { name: string } }>) => {
    const info = pm.get(request.params.name as CasaName);
    if (!info) {
      return { status: "not_found" };
    }
    return { name: info.name, state: info.state, port: info.port };
  });
}
