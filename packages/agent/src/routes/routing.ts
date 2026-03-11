import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  type AclEngine,
  type Capability,
  AclDeniedError,
  BotNotFoundError,
  readBotConfig,
  isValidName,
} from "@mecha/core";
import { join } from "node:path";
import { getSource } from "../auth.js";
import { resolveNodeEntry } from "../node-resolve.js";
import { agentFetch } from "@mecha/service";
import { daemonChat, type DaemonChatResult } from "../daemon-chat.js";

/** Chat function signature — matches daemonChat, injectable for testing. */
export type ChatFn = (mechaDir: string, botName: string, message: string, sessionId?: string) => Promise<DaemonChatResult>;

/** Options for inter-bot query routing routes. */
export interface RoutingRouteOpts {
  mechaDir: string;
  acl: AclEngine;
  nodeName?: string;
  /** Override the daemon chat function (for testing). Defaults to daemonChat. */
  chatFn?: ChatFn;
}

/** Register POST /bots/:name/query for ACL-gated inter-bot message routing. */
export function registerRoutingRoutes(app: FastifyInstance, opts: RoutingRouteOpts): void {
  const { mechaDir, acl } = opts;
  const node = opts.nodeName ?? "local";
  const chat = opts.chatFn ?? daemonChat;

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
      // Default to "admin" for dashboard/session-authenticated requests.
      // Local-first: session auth = machine owner = admin identity.
      const source = getSource(request) ?? "admin";

      if (typeof message !== "string" || !message.trim()) {
        reply.code(400).send({ error: "Missing required field: message (string)" });
        return;
      }

      if (sessionId !== undefined && typeof sessionId !== "string") {
        reply.code(400).send({ error: "Invalid field: sessionId must be a string" });
        return;
      }

      if (!isValidName(target)) {
        reply.code(400).send({ error: `Invalid bot name: ${target}` });
        return;
      }

      // Check bot exists before ACL — prevents leaking ACL state for nonexistent bots
      const config = readBotConfig(join(mechaDir, target));
      if (!config) {
        reply.code(404).send({ error: new BotNotFoundError(target).message });
        return;
      }

      // ACL check — always enforced
      const capability: Capability = "query";
      const aclResult = acl.check(source, target, capability);
      if (!aclResult.allowed) {
        reply.code(403).send({ error: new AclDeniedError(source, "query", target).message });
        return;
      }

      try {
        // Execute SDK query in the daemon process (not the bot runtime).
        // Bot runtimes run as Bun SEA child processes which cannot posix_spawn
        // external binaries on macOS. The daemon (top-level process) can spawn.
        const result = await chat(mechaDir, target, message, sessionId);
        return { response: result.response, sessionId: result.sessionId };
      } catch (err) {
        /* v8 ignore start -- SDK errors are runtime-only */
        const detail = err instanceof Error ? err.message : String(err);
        request.log.error(`SDK chat for bot "${target}" failed: ${detail}`);
        reply.code(502).send({ error: `Chat failed: ${detail}` });
        /* v8 ignore stop */
      }
    },
  );
}
