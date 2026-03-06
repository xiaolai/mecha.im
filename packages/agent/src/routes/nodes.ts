import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { addNode, removeNode, readNodes, isValidName, promoteDiscoveredNode } from "@mecha/core";
import { nodePing } from "@mecha/service";

export interface NodeRouteOpts {
  mechaDir: string;
}

export function registerNodeRoutes(app: FastifyInstance, opts: NodeRouteOpts): void {
  const { mechaDir } = opts;

  app.get("/nodes", async () => {
    return readNodes(mechaDir);
  });

  app.post("/nodes", async (request: FastifyRequest, reply: FastifyReply) => {
    /* v8 ignore start -- Fastify always parses body for POST */
    const body = (request.body ?? {}) as { name?: string; host?: string; port?: unknown; apiKey?: string };
    /* v8 ignore stop */
    if (!body.name || !body.host || !body.port || !body.apiKey) {
      reply.code(400).send({ error: "name, host, port, and apiKey are required" });
      return;
    }
    if (!isValidName(body.name)) {
      reply.code(400).send({ error: `Invalid node name: ${body.name}` });
      return;
    }
    /* v8 ignore start -- port type branch: Fastify parses JSON numbers natively */
    const port = typeof body.port === "number" ? body.port : parseInt(String(body.port), 10);
    /* v8 ignore stop */
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      reply.code(400).send({ error: "port must be a valid port number" });
      return;
    }
    try {
      addNode(mechaDir, {
        name: body.name,
        host: body.host,
        port,
        apiKey: body.apiKey,
        addedAt: new Date().toISOString(),
      });
      return { ok: true };
    } catch (err: unknown) {
      /* v8 ignore start -- non-Error throw fallback */
      const message = err instanceof Error ? err.message : String(err);
      /* v8 ignore stop */
      reply.code(409).send({ error: message });
    }
  });

  app.delete("/nodes/:name", async (request: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
    const { name } = request.params;
    if (!isValidName(name)) {
      reply.code(400).send({ error: `Invalid node name: ${name}` });
      return;
    }
    const removed = removeNode(mechaDir, name);
    if (!removed) {
      reply.code(404).send({ error: `Node not found: ${name}` });
      return;
    }
    return { ok: true };
  });

  app.post("/nodes/:name/ping", async (request: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
    const { name } = request.params;
    try {
      const result = await nodePing(mechaDir, name);
      return result;
    } catch (err: unknown) {
      /* v8 ignore start -- non-Error throw fallback */
      const message = err instanceof Error ? err.message : String(err);
      /* v8 ignore stop */
      reply.code(404).send({ error: message });
    }
  });

  app.post("/nodes/:name/promote", async (request: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
    const { name } = request.params;
    const entry = promoteDiscoveredNode(mechaDir, name);
    if (!entry) {
      reply.code(404).send({ error: `Discovered node not found: ${name}` });
      return;
    }
    return { ok: true, node: entry };
  });
}
