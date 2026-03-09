import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { mechaToolLs, mechaToolInstall, mechaToolRemove, resolveClaudeRuntime } from "@mecha/service";

/** Options for tool management routes. */
export interface ToolRouteOpts {
  mechaDir: string;
}

/** Register tool management routes (list, install, remove). */
export function registerToolRoutes(app: FastifyInstance, opts: ToolRouteOpts): void {
  const { mechaDir } = opts;

  app.get("/tools", async () => {
    return mechaToolLs(mechaDir);
  });

  app.get("/tools/runtime", async () => {
    return await resolveClaudeRuntime();
  });

  app.post("/tools", async (request: FastifyRequest, reply: FastifyReply) => {
    /* v8 ignore start -- Fastify always parses body for POST */
    const body = (request.body ?? {}) as { name?: string; version?: string; description?: string };
    /* v8 ignore stop */
    if (!body.name || typeof body.name !== "string") {
      reply.code(400).send({ error: "name is required and must be a string" });
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
