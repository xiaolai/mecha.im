/**
 * Agent HTTP server — receives bot queries from local CLI and remote mesh nodes.
 *
 * Routes:
 * - GET  /healthz                  — liveness check (no auth)
 * - GET  /bots                     — list local bots (for mesh discovery)
 * - POST /bots/:botName/query      — forward a query to a local bot
 */
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { join } from "node:path";
import {
  isValidName,
  readBotConfig,
  forwardQueryToBot,
} from "@mecha/core";
import type { AclEngine, Capability } from "@mecha/core";
import type { ProcessManager } from "@mecha/process";
import { createAuthHook, createAuthContext, verifyRequestSignature } from "./auth.js";
import type { AuthConfig } from "./auth.js";
import { registerTaskRoutes } from "./task-routes.js";

export interface AgentServerOptions {
  port: number;
  auth: AuthConfig;
  processManager: ProcessManager;
  acl: AclEngine;
  mechaDir: string;
  nodeName: string;
  startedAt?: string;
  publicIp?: string;
  /** PTY spawn function — stored for future terminal routes. */
  ptySpawnFn?: unknown;
  /** Path to built SPA assets. When set, registers @fastify/static (resolved from caller's node_modules). */
  spaDir?: string;
}

interface QueryBody {
  message: string;
  sessionId?: string;
  requestId?: string;
}

/**
 * Create and configure the agent Fastify server.
 * Returns an unstarted Fastify instance — call .listen() to bind.
 */
export function createAgentServer(opts: AgentServerOptions): FastifyInstance {
  const { auth, acl, mechaDir } = opts;
  const authCtx = createAuthContext(auth, mechaDir);

  const app = Fastify({ logger: false });

  // Auth hook — validates session cookie on all routes except /healthz
  app.addHook("preHandler", createAuthHook(authCtx));

  // Health check
  app.get("/healthz", async () => ({ status: "ok" }));

  // Task protocol routes
  registerTaskRoutes(app, { mechaDir, acl, authCtx });

  // Bot listing route — used by `bot ls --mesh` on remote nodes
  app.get("/bots", async () => {
    const list = opts.processManager.list();
    return list.map((b) => {
      const config = readBotConfig(join(mechaDir, b.name));
      return { name: b.name, state: b.state, port: b.port ?? 0, tags: config?.tags ?? [] };
    });
  });

  // Bot query route
  app.post<{ Params: { botName: string }; Body: QueryBody }>(
    "/bots/:botName/query",
    async (req, reply) => {
      const { botName } = req.params;

      // Validate bot name
      if (!isValidName(botName)) {
        return reply.status(400).send({ error: "Invalid bot name" });
      }

      // Parse body
      const body = req.body as QueryBody;
      if (!body || typeof body.message !== "string" || body.message.trim() === "") {
        return reply.status(400).send({ error: "Missing or empty message" });
      }

      // Verify request signature if present
      const rawBody = JSON.stringify(req.body);
      const sigError = verifyRequestSignature(req, rawBody, authCtx);
      if (sigError) {
        return reply.status(401).send({ error: sigError });
      }

      // ACL check — source from header, defaults to "admin"
      const source = (req.headers["x-mecha-source"] as string) ?? "admin";
      const aclResult = acl.check(source, botName, "query" as Capability);
      if (!aclResult.allowed) {
        return reply.status(403).send({ error: "Access denied", reason: aclResult.reason });
      }

      // Find bot config to get port and token
      const botDir = join(mechaDir, botName);
      const config = readBotConfig(botDir);
      if (!config) {
        return reply.status(404).send({ error: `Bot '${botName}' not found` });
      }

      // Forward query to the bot process
      try {
        const result = await forwardQueryToBot(
          config.port,
          config.token,
          body.message,
          body.sessionId,
          body.requestId,
        );
        return reply.send({
          response: result.text,
          sessionId: result.sessionId ?? null,
        });
      /* v8 ignore start -- forwarding failure requires unreachable bot process */
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(502).send({ error: `Forwarding failed: ${msg}` });
      }
      /* v8 ignore stop */
    },
  );

  // Serve SPA static files if spaDir is provided
  // @fastify/static is optional — resolved from the caller's node_modules at runtime.
  /* v8 ignore start -- SPA serving requires built SPA assets and @fastify/static from caller */
  if (opts.spaDir) {
    const spaDir = opts.spaDir;
    void import("@fastify/static" as string).then(
      (mod) => app.register(mod.default ?? mod, { root: spaDir, prefix: "/", wildcard: false }),
      () => { /* @fastify/static not available — skip SPA serving */ },
    );
    app.setNotFoundHandler(async (_req, reply) => {
      return (reply as unknown as { sendFile(f: string, r?: string): Promise<void> }).sendFile("index.html", spaDir);
    });
  }
  /* v8 ignore stop */

  return app;
}
