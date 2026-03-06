import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { mechaToolLs, mechaToolInstall, mechaToolRemove } from "@mecha/service";

export interface ToolRouteOpts {
  mechaDir: string;
}

export function registerToolRoutes(app: FastifyInstance, opts: ToolRouteOpts): void {
  const { mechaDir } = opts;

  app.get("/tools", async () => {
    return mechaToolLs(mechaDir);
  });

  app.post("/tools", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as { name?: string; version?: string; description?: string };
    if (!body.name) {
      reply.code(400).send({ error: "name is required" });
      return;
    }
    try {
      const tool = mechaToolInstall(mechaDir, {
        name: body.name,
        version: body.version,
        description: body.description,
      });
      return { ok: true, tool };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      reply.code(400).send({ error: message });
    }
  });

  app.delete("/tools/:name", async (request: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
    const { name } = request.params;
    try {
      const removed = mechaToolRemove(mechaDir, name);
      if (!removed) {
        reply.code(404).send({ error: `Tool not found: ${name}` });
        return;
      }
      return { ok: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      reply.code(400).send({ error: message });
    }
  });
}
