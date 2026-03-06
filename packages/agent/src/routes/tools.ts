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
    /* v8 ignore start -- Fastify always parses body for POST */
    const body = (request.body ?? {}) as { name?: string; version?: string; description?: string };
    /* v8 ignore stop */
    if (!body.name) {
      reply.code(400).send({ error: "name is required" });
      return;
    }
    if (body.version !== undefined && typeof body.version !== "string") {
      reply.code(400).send({ error: "version must be a string" });
      return;
    }
    if (body.description !== undefined && typeof body.description !== "string") {
      reply.code(400).send({ error: "description must be a string" });
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
      /* v8 ignore start -- non-Error throw fallback */
      const message = err instanceof Error ? err.message : String(err);
      /* v8 ignore stop */
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
      /* v8 ignore start -- non-Error throw fallback */
      const message = err instanceof Error ? err.message : String(err);
      /* v8 ignore stop */
      reply.code(400).send({ error: message });
    }
  });
}
