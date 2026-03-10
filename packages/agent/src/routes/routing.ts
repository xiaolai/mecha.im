import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  type AclEngine,
  type Capability,
  AclDeniedError,
  BotNotFoundError,
  readBotConfig,
  forwardQueryToBot,
  isValidName,
} from "@mecha/core";
import { join } from "node:path";
import { getSource } from "../auth.js";
import { resolveNodeEntry } from "../node-resolve.js";
import { agentFetch } from "@mecha/service";

/** Options for inter-bot query routing routes. */
export interface RoutingRouteOpts {
  mechaDir: string;
  acl: AclEngine;
  nodeName?: string;
}

/** Register POST /bots/:name/query for ACL-gated inter-bot message routing. */
export function registerRoutingRoutes(app: FastifyInstance, opts: RoutingRouteOpts): void {
  const { mechaDir, acl } = opts;
  const node = opts.nodeName ?? "local";

  app.post(
    "/bots/:name/query",
    async (
      request: FastifyRequest<{
        Params: { name: string };
        Querystring: { node?: string };
        Body: { message: string; sessionId?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const target = request.params.name;
      const targetNode = (request.query as { node?: string }).node;

      // Proxy to remote node if requested
      /* v8 ignore start -- cross-node routing tested via integration tests */
      if (targetNode && targetNode !== node && targetNode !== "local") {
        const entry = resolveNodeEntry(mechaDir, targetNode);
        if (!entry) {
          reply.code(404).send({ error: `Node not found: ${targetNode}` });
          return;
        }
        try {
          const res = await agentFetch({
            node: entry,
            path: `/bots/${encodeURIComponent(target)}/query`,
            method: "POST",
            source: node,
            timeoutMs: 30_000,
            body: request.body,
          });
          if (!res.ok) {
            reply.code(502).send({ error: `Remote node "${targetNode}" returned ${res.status}` });
            return;
          }
          const data = await res.json();
          reply.send(data);
          return;
        } catch (err) {
          const cause = err instanceof Error ? err.message : String(err);
          reply.code(502).send({ error: `Cannot reach node "${targetNode}": ${cause}` });
          return;
        }
      }
      /* v8 ignore stop */

      /* v8 ignore start -- Fastify always parses POST body; ?? is defensive */
      const { message, sessionId } = request.body ?? {};
      /* v8 ignore stop */
      // Default to "admin" for dashboard/session-authenticated requests
      const source = getSource(request) ?? "admin";

      if (typeof message !== "string" || !message) {
        reply.code(400).send({ error: "Missing required field: message (string)" });
        return;
      }

      if (!isValidName(target)) {
        reply.code(400).send({ error: `Invalid bot name: ${target}` });
        return;
      }

      // ACL check — always enforced
      const aclResult = acl.check(source, target, "query" as Capability);
      if (!aclResult.allowed) {
        reply.code(403).send({ error: new AclDeniedError(source, "query", target).message });
        return;
      }

      const config = readBotConfig(join(mechaDir, target));
      if (!config) {
        reply.code(404).send({ error: new BotNotFoundError(target).message });
        return;
      }

      try {
        const fwd = await forwardQueryToBot(config.port, config.token, message, sessionId);
        return { response: fwd.text, sessionId: fwd.sessionId };
      } catch (err) {
        /* v8 ignore start -- upstream connection errors are runtime-only */
        const detail = err instanceof Error ? err.message : String(err);
        request.log.error(`Routing to bot "${target}" failed: ${detail}`);
        const code = err instanceof Error && "code" in err && (err as { code: string }).code === "UND_ERR_CONNECT_TIMEOUT" ? 504 : 502;
        reply.code(code).send({ error: "Upstream bot unavailable" });
        /* v8 ignore stop */
      }
    },
  );
}
