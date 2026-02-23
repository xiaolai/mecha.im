import type { FastifyInstance } from "fastify";
import type { ConfigStore } from "./config-store.js";

export function registerConfigRoutes(
  app: FastifyInstance,
  configStore: ConfigStore | undefined,
): void {
  // If no config store, all routes return 503
  if (!configStore) {
    const unavailable = async (_req: unknown, reply: { code: (n: number) => { send: (body: unknown) => unknown } }) =>
      reply.code(503).send({ error: "Config store not available" });
    app.get("/api/config", unavailable);
    app.get("/api/config/:key", unavailable);
    app.put("/api/config/:key", unavailable);
    app.delete("/api/config/:key", unavailable);
    return;
  }

  const store = configStore;

  // GET /api/config — list all config entries (optional ?prefix=)
  app.get("/api/config", async (req, reply) => {
    const query = req.query as { prefix?: string };
    const entries = store.list(query.prefix);
    return reply.send(entries);
  });

  // GET /api/config/:key — get a single config value
  app.get("/api/config/:key", async (req, reply) => {
    const { key } = req.params as { key: string };
    const value = store.get(key);
    if (value === null) {
      return reply.code(404).send({ error: `Config key not found: ${key}` });
    }
    return reply.send({ key, value });
  });

  // PUT /api/config/:key — set a config value
  app.put("/api/config/:key", async (req, reply) => {
    const { key } = req.params as { key: string };
    const body = req.body as { value?: string } | null;
    if (!body || typeof body.value !== "string") {
      return reply.code(400).send({ error: "Missing 'value' field (string)" });
    }
    store.set(key, body.value);
    return reply.send({ key, value: body.value });
  });

  // DELETE /api/config/:key — delete a config value
  app.delete("/api/config/:key", async (req, reply) => {
    const { key } = req.params as { key: string };
    const deleted = store.delete(key);
    if (!deleted) {
      return reply.code(404).send({ error: `Config key not found: ${key}` });
    }
    return reply.code(204).send();
  });
}
