import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { addNode, removeNode, readNodes, isValidName, promoteDiscoveredNode, NodeNotFoundError, DuplicateNodeError } from "@mecha/core";
import { nodePing } from "@mecha/service";

/** Options for node management routes. */
export interface NodeRouteOpts {
  mechaDir: string;
}

/** Register node management routes (list, add, remove). */
export function registerNodeRoutes(app: FastifyInstance, opts: NodeRouteOpts): void {
  const { mechaDir } = opts;

  app.get("/nodes", async () => {
    return readNodes(mechaDir).map(({ apiKey, ...rest }) => ({ ...rest, hasApiKey: !!apiKey }));
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
    const port = Number(body.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      reply.code(400).send({ error: "port must be an integer between 1 and 65535" });
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
      if (err instanceof DuplicateNodeError) {
        reply.code(409).send({ error: err.message });
        return;
      }
      throw err;
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
      if (err instanceof NodeNotFoundError) {
        reply.code(404).send({ error: err.message });
        return;
      }
      throw err;
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
