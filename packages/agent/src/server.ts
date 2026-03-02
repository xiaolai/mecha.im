import { readFileSync } from "node:fs";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyWebSocket from "@fastify/websocket";
import { type AclEngine, MechaError, readNodes, verifySignature, fetchPublicIp } from "@mecha/core";
import type { ProcessManager, PtySpawnFn } from "@mecha/process";
import { createAuthHook, createSignatureHook, API_PREFIXES } from "./auth.js";
import { deriveSessionKey } from "./session.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerCasaRoutes } from "./routes/casas.js";
import { registerRoutingRoutes } from "./routes/routing.js";
import { registerDiscoverRoutes } from "./routes/discover.js";
import { registerSessionRoutes } from "./routes/sessions.js";
import { registerTerminalRoutes } from "./routes/terminal.js";
import { registerAclRoutes } from "./routes/acl.js";
import { registerAuditRoutes } from "./routes/audit.js";
import { registerMeshRoutes } from "./routes/mesh.js";
import { registerMeterRoutes } from "./routes/meter.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerEventsRoutes } from "./routes/events.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { createPtyManager } from "./pty-manager.js";
import { issueTicket, purgeTickets } from "./ws-tickets.js";

export interface AgentServerAuth {
  /** API key for Bearer token auth. Omit to disable. */
  apiKey?: string;
  /** TOTP secret (base32). When set, enables session-based TOTP auth. */
  totpSecret?: string;
  /** Session TTL in hours (default: 24). */
  sessionTtlHours?: number;
}

export interface AgentServerOpts {
  port: number;
  auth: AgentServerAuth;
  processManager: ProcessManager;
  acl: AclEngine;
  mechaDir: string;
  nodeName: string;
  /** ISO timestamp of when the server started. */
  startedAt: string;
  /** Cached public IP (fetched at startup). */
  publicIp?: string;
  /** Injected PTY spawn function (for terminal WS). Omit to disable terminal. */
  ptySpawnFn?: PtySpawnFn;
  /** Path to SPA dist directory. When set, serves static SPA files. */
  spaDir?: string;
}

/** Fetch public IP for server startup. Call before createAgentServer(). */
export { fetchPublicIp } from "@mecha/core";

export function createAgentServer(opts: AgentServerOpts): FastifyInstance {
  const app = Fastify({
    logger: {
      redact: ["req.headers.authorization", "req.headers['x-mecha-signature']"],
    },
  });

  // Global error handler — map MechaError to correct HTTP status
  /* v8 ignore start -- error handler tested via route-level integration tests */
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof MechaError) {
      reply.code(err.statusCode).send({ error: err.message, code: err.code });
    } else {
      app.log.error(err);
      reply.code(500).send({ error: "Internal server error" });
    }
  });
  /* v8 ignore stop */

  /* v8 ignore start -- node key loading requires live nodes.json + readNodes */
  // Build node public key map for signature verification.
  // Reloaded from disk on each resolution to pick up key rotation/revocation.
  function loadNodePublicKeys(): Map<string, string> {
    const keys = new Map<string, string>();
    try {
      const nodes = readNodes(opts.mechaDir);
      for (const node of nodes) {
        if (node.publicKey) keys.set(node.name, node.publicKey);
      }
    } catch (err) {
      // Fail closed: empty map means all signed routing requests are rejected.
      app.log.warn("Failed to read nodes.json — routing will reject signed requests: %s",
        err instanceof Error ? err.message : String(err));
    }
    return keys;
  }

  const initialKeys = loadNodePublicKeys();
  /* v8 ignore stop */

  // Derive session key from TOTP secret if TOTP is enabled
  const sessionKey = opts.auth.totpSecret
    ? deriveSessionKey(opts.auth.totpSecret)
    : undefined;

  /* v8 ignore start -- auth wiring tested via auth.test.ts + server.test.ts */
  const authOpts = {
    apiKey: opts.auth.apiKey,
    sessionKey,
    // Lazy-loading getter so keys are re-read from disk on each request
    get nodePublicKeys() {
      const keys = loadNodePublicKeys();
      return keys.size > 0 ? keys : undefined;
    },
    verifySignature: initialKeys.size > 0 ? verifySignature : undefined,
    spaDir: opts.spaDir,
  };

  app.addHook("onRequest", createAuthHook(authOpts));
  // Signature hook runs in preHandler (after body parsing) so request.body is available
  app.addHook("preHandler", createSignatureHook(authOpts));
  /* v8 ignore stop */

  // Auth routes (public: /auth/status, /auth/login, /auth/logout)
  registerAuthRoutes(app, {
    totpSecret: opts.auth.totpSecret,
    apiKey: opts.auth.apiKey,
    sessionKey,
    sessionTtlHours: opts.auth.sessionTtlHours,
  });

  registerHealthRoutes(app, {
    nodeName: opts.nodeName,
    port: opts.port,
    processManager: opts.processManager,
    startedAt: opts.startedAt,
    publicIp: opts.publicIp,
  });
  registerCasaRoutes(app, opts.processManager, opts.mechaDir);
  registerRoutingRoutes(app, { mechaDir: opts.mechaDir, acl: opts.acl });
  registerDiscoverRoutes(app, { mechaDir: opts.mechaDir, pm: opts.processManager });
  registerSessionRoutes(app, opts.processManager);
  registerAclRoutes(app, { acl: opts.acl });
  registerAuditRoutes(app, { mechaDir: opts.mechaDir });
  registerMeshRoutes(app, {
    mechaDir: opts.mechaDir,
    nodeName: opts.nodeName,
    processManager: opts.processManager,
    port: opts.port,
    startedAt: opts.startedAt,
    publicIp: opts.publicIp,
  });
  registerMeterRoutes(app, { mechaDir: opts.mechaDir });
  registerSettingsRoutes(app);
  registerEventsRoutes(app, { processManager: opts.processManager });

  /* v8 ignore start -- WS ticket endpoint tested via auth + ws-tickets unit tests */
  app.post("/ws/ticket", async () => {
    purgeTickets();
    return { ticket: issueTicket() };
  });
  /* v8 ignore stop */

  /* v8 ignore start -- SPA static file serving */
  if (opts.spaDir) {
    registerSpaRoutes(app, opts.spaDir);
  }
  /* v8 ignore stop */

  /* v8 ignore start -- terminal WS wiring tested in terminal.test.ts + pty-manager.test.ts */
  if (opts.ptySpawnFn) {
    const ptyManager = createPtyManager({
      processManager: opts.processManager,
      mechaDir: opts.mechaDir,
      spawnFn: opts.ptySpawnFn,
    });

    // Terminal routes MUST be registered inside the websocket plugin scope.
    // @fastify/websocket adds an onRoute hook that intercepts { websocket: true }
    // handlers — routes registered outside the plugin scope won't be intercepted.
    app.register(async (instance) => {
      await instance.register(fastifyWebSocket);
      registerTerminalRoutes(instance, ptyManager);
    });

    app.addHook("onClose", () => {
      ptyManager.shutdown();
    });
  }
  /* v8 ignore stop */

  return app;
}

/* v8 ignore start -- SPA serving is tested via integration/E2E */

/** Check if a path is an API or auth endpoint (shared by auth hook + SPA fallback). */
function isApiOrAuthPath(pathname: string): boolean {
  return API_PREFIXES.some((p) => pathname.startsWith(p))
    || pathname === "/healthz" || pathname.startsWith("/auth/");
}
function registerSpaRoutes(app: FastifyInstance, spaDir: string): void {
  const indexHtml = readFileSync(join(spaDir, "index.html"), "utf-8");

  app.register(async (instance) => {
    const { default: fastifyStatic } = await import("@fastify/static");
    instance.register(fastifyStatic, {
      root: spaDir,
      prefix: "/",
      wildcard: false,
      decorateReply: false,
    });
  });

  app.setNotFoundHandler(async (request, reply) => {
    // SPA fallback: GET requests → index.html for client-side routing.
    // Browser navigations (Accept: text/html) to SPA routes like /mesh or /casas
    // must serve the SPA even though the path overlaps with API prefixes.
    if (request.method === "GET") {
      const accept = request.headers.accept ?? "";
      const p = request.url.split("?")[0]!;
      const isBrowserNav = accept.includes("text/html");
      if (isBrowserNav || !isApiOrAuthPath(p)) {
        return reply.type("text/html").send(indexHtml);
      }
    }
    reply.code(404).send({ error: "Not found" });
  });
}
/* v8 ignore stop */
