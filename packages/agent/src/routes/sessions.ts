import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { type BotName, isValidName } from "@mecha/core";
import type { ProcessManager } from "@mecha/process";
import { botSessionList, botSessionGet, botSessionDelete, agentFetch } from "@mecha/service";
import { resolveNodeEntry } from "../node-resolve.js";

/** Validate + resolve bot from route params. Returns botName or sends error reply. */
function resolveBot(
  pm: ProcessManager,
  request: FastifyRequest<{ Params: { name: string } }>,
  reply: FastifyReply,
): BotName | null {
  const name = request.params.name;
  if (!isValidName(name)) {
    reply.code(400).send({ error: `Invalid bot name: ${name}` });
    return null;
  }
  const botName = name as BotName;
  if (!pm.get(botName)) {
    reply.code(404).send({ error: `bot not found: ${botName}` });
    return null;
  }
  return botName;
}

/**
 * Proxy a session request to a remote node if ?node= targets a different node.
 * Returns true if the request was proxied (caller should return early).
 */
/* v8 ignore start -- proxy requires live remote node */
async function proxyToNode(
  mechaDir: string, localNode: string, targetNode: string | undefined,
  path: string, method: string, reply: FastifyReply,
): Promise<boolean> {
  if (!targetNode || targetNode === localNode || targetNode === "local") return false;
  const entry = resolveNodeEntry(mechaDir, targetNode);
  if (!entry) { reply.code(404).send({ error: `Node not found: ${targetNode}` }); return true; }
  try {
    const res = await agentFetch({ node: entry, path, method, source: localNode, timeoutMs: 10_000 });
    if (!res.ok) { reply.code(502).send({ error: `Remote node "${targetNode}" returned ${res.status}` }); return true; }
    const data = await res.json();
    reply.send(data);
    return true;
  } catch { reply.code(502).send({ error: `Cannot reach node "${targetNode}"` }); return true; }
}
/* v8 ignore stop */

/** Register bot session routes: list, get, and delete sessions for a bot. */
export function registerSessionRoutes(app: FastifyInstance, pm: ProcessManager, mechaDir: string, nodeName?: string): void {
  const node = nodeName ?? "local";

  app.get("/bots/:name/sessions", async (request: FastifyRequest<{ Params: { name: string }; Querystring: { node?: string } }>, reply: FastifyReply) => {
    /* v8 ignore start -- proxy requires live remote node */
    if (await proxyToNode(mechaDir, node, request.query.node, `/bots/${encodeURIComponent(request.params.name)}/sessions`, "GET", reply)) return;
    /* v8 ignore stop */
    const botName = resolveBot(pm, request as FastifyRequest<{ Params: { name: string } }>, reply);
    if (!botName) return;
    try {
      return await botSessionList(pm, botName);
    /* v8 ignore start -- non-Error throw is defensive */
    } catch (err) {
      reply.code(502).send({ error: `Failed to fetch sessions: ${err instanceof Error ? err.message : String(err)}` });
    }
    /* v8 ignore stop */
  });

  app.get("/bots/:name/sessions/:id", async (
    request: FastifyRequest<{ Params: { name: string; id: string }; Querystring: { node?: string } }>,
    reply: FastifyReply,
  ) => {
    /* v8 ignore start -- proxy requires live remote node */
    if (await proxyToNode(mechaDir, node, request.query.node, `/bots/${encodeURIComponent(request.params.name)}/sessions/${encodeURIComponent(request.params.id)}`, "GET", reply)) return;
    /* v8 ignore stop */
    const botName = resolveBot(pm, request as FastifyRequest<{ Params: { name: string } }>, reply);
    if (!botName) return;
    try {
      const session = await botSessionGet(pm, botName, request.params.id);
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

  app.delete("/bots/:name/sessions/:id", async (
    request: FastifyRequest<{ Params: { name: string; id: string }; Querystring: { node?: string } }>,
    reply: FastifyReply,
  ) => {
    /* v8 ignore start -- proxy requires live remote node */
    if (await proxyToNode(mechaDir, node, request.query.node, `/bots/${encodeURIComponent(request.params.name)}/sessions/${encodeURIComponent(request.params.id)}`, "DELETE", reply)) return;
    /* v8 ignore stop */
    const botName = resolveBot(pm, request as FastifyRequest<{ Params: { name: string } }>, reply);
    if (!botName) return;
    try {
      const deleted = await botSessionDelete(pm, botName, request.params.id);
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
