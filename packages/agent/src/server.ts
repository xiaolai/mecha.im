import { readFileSync } from "node:fs";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyWebSocket from "@fastify/websocket";
import { type AclEngine, MechaError, readNodes, verifySignature, fetchPublicIp, readMechaSettings } from "@mecha/core";
import type { ProcessManager, PtySpawnFn } from "@mecha/process";
import { createAuthHook, createSignatureHook, API_PREFIXES } from "./auth.js";
import { deriveSessionKey } from "./session.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerBotRoutes } from "./routes/bots.js";
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
import { registerEventLogRoutes } from "./routes/event-log.js";
import { registerHandshakeRoute } from "./routes/discover-handshake.js";
import { startDiscoveryLoop } from "./discovery-loop.js";
import { registerScheduleRoutes } from "./routes/schedules.js";
import { registerScheduleOverviewRoutes } from "./routes/schedule-overview.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { createEventLog, emitEvent, type EventLog } from "./event-log.js";
import { createPtyManager } from "./pty-manager.js";
import { issueTicket, purgeTickets } from "./ws-tickets.js";

export interface AgentServerAuth {
  /** TOTP secret (base32). When set, enables session-based TOTP auth. */
  totpSecret?: string;
  /** Session TTL in hours (default: 24). */
  sessionTtlHours?: number;
  /** Internal API key for mesh node-to-node routing (Bearer token). */
  apiKey?: string;
}

/** Configuration for the agent server. */
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

/** Create and configure the Fastify agent server with all routes, auth, and middleware. */
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
  /* v8 ignore start -- TOTP presence varies by deployment config */
  const sessionKey = opts.auth.totpSecret
    ? deriveSessionKey(opts.auth.totpSecret)
    : undefined;
  /* v8 ignore stop */

  /* v8 ignore start -- auth wiring tested via auth.test.ts + server.test.ts */
  // Pre-read SPA index.html for browser navigation handling in auth hook
  let spaIndexHtml: string | undefined;
  if (opts.spaDir) {
    try { spaIndexHtml = readFileSync(join(opts.spaDir, "index.html"), "utf-8"); } catch { /* no SPA */ }
  }

  const authOpts = {
    sessionKey,
    apiKey: opts.auth.apiKey,
    // Lazy-loading getter so keys are re-read from disk on each request
    get nodePublicKeys() {
      const keys = loadNodePublicKeys();
      return keys.size > 0 ? keys : undefined;
    },
    verifySignature,
    spaDir: opts.spaDir,
    spaIndexHtml,
  };

  /* v8 ignore start -- HTTPS redirect depends on deployment config */
  // Force HTTPS redirect — runs BEFORE auth so credentials are never sent over HTTP.
  // Cached with 5s TTL to avoid synchronous file I/O on every request.
  let _httpsCache: { forceHttps: boolean; ts: number } | undefined;
  function isForceHttps(): boolean {
    const now = Date.now();
    if (_httpsCache && now - _httpsCache.ts < 5000) return _httpsCache.forceHttps;
    const settings = readMechaSettings(opts.mechaDir);
    _httpsCache = { forceHttps: !!settings.forceHttps, ts: now };
    return _httpsCache.forceHttps;
  }

  app.addHook("onRequest", async (request, reply) => {
    const proto = request.headers["x-forwarded-proto"] ?? request.protocol;
    if (proto === "https") return;
    if (!isForceHttps()) return;
    // WebSocket upgrades cannot follow redirects — reject instead
    if (request.headers.upgrade?.toLowerCase() === "websocket") {
      reply.code(403).send({ error: "WSS required when HTTPS is forced" });
      return;
    }
    // Only redirect GET/HEAD — other methods lose body on redirect
    if (request.method !== "GET" && request.method !== "HEAD") {
      reply.code(403).send({ error: "HTTPS required" });
      return;
    }
    // Prevent open redirect: only use Host header if it looks like a valid host:port,
    // otherwise fall back to localhost. Reject headers with path separators or protocols.
    const rawHost = request.headers.host;
    const host = rawHost && /^[\w.:-]+$/.test(rawHost) ? rawHost : `localhost:${opts.port}`;
    reply.code(301).redirect(`https://${host}${request.url}`);
  });
  /* v8 ignore stop */

  app.addHook("onRequest", createAuthHook(authOpts));
  // Signature hook runs in preHandler (after body parsing) so request.body is available
  app.addHook("preHandler", createSignatureHook(authOpts));
  /* v8 ignore stop */

  // --- Event log (persisted system events) ---
  const eventLog = createEventLog(opts.mechaDir);

  // Subscribe to process lifecycle events → persist as system events
  opts.processManager.onEvent((event) => {
    switch (event.type) {
      case "spawned":
        emitEvent(eventLog, "info", "process", "bot.spawned",
          `Bot ${event.name} spawned (pid=${event.pid}, port=${event.port})`,
          { name: event.name, pid: event.pid, port: event.port });
        break;
      case "stopped":
        emitEvent(eventLog, "info", "process", "bot.stopped",
          `Bot ${event.name} stopped (exit=${event.exitCode ?? "unknown"})`,
          { name: event.name, exitCode: event.exitCode });
        break;
      case "error":
        emitEvent(eventLog, "error", "process", "bot.error",
          `Bot ${event.name}: ${event.error}`,
          { name: event.name });
        break;
      case "warning":
        emitEvent(eventLog, "warn", "process", "bot.warning",
          `Bot ${event.name}: ${event.message}`,
          { name: event.name });
        break;
    }
  });

  emitEvent(eventLog, "info", "server", "server.started",
    `Server started on port ${opts.port}`, { port: opts.port, nodeName: opts.nodeName });

  app.addHook("onClose", () => {
    emitEvent(eventLog, "info", "server", "server.shutdown", "Server shutting down");
  });

  // Auth routes (public: /auth/status, /auth/login, /auth/logout)
  registerAuthRoutes(app, {
    totpSecret: opts.auth.totpSecret,
    sessionKey,
    sessionTtlHours: opts.auth.sessionTtlHours,
    eventLog,
  });

  registerHealthRoutes(app, {
    nodeName: opts.nodeName,
    port: opts.port,
    processManager: opts.processManager,
    startedAt: opts.startedAt,
    publicIp: opts.publicIp,
  });
  registerBotRoutes(app, opts.processManager, opts.mechaDir, opts.nodeName);
  registerRoutingRoutes(app, { mechaDir: opts.mechaDir, acl: opts.acl });
  registerDiscoverRoutes(app, { mechaDir: opts.mechaDir, pm: opts.processManager });
  registerSessionRoutes(app, opts.processManager);
  registerScheduleRoutes(app, opts.processManager);
  registerScheduleOverviewRoutes(app, opts.processManager, opts.nodeName);
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

  // Auto-discovery handshake + loop (only active when cluster key is set)
  const clusterKey = process.env.MECHA_CLUSTER_KEY;
  if (clusterKey) {
    registerHandshakeRoute(app, {
      clusterKey,
      nodeName: opts.nodeName,
      port: opts.port,
      mechaDir: opts.mechaDir,
      meshApiKey: opts.auth.apiKey,
    });
    const stopDiscovery = startDiscoveryLoop({
      clusterKey,
      nodeName: opts.nodeName,
      port: opts.port,
      mechaDir: opts.mechaDir,
    });
    app.addHook("onClose", stopDiscovery);
  }
  registerSettingsRoutes(app, { mechaDir: opts.mechaDir });
  registerEventsRoutes(app, { processManager: opts.processManager });
  registerEventLogRoutes(app, { eventLog });

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
    // Browser navigations (Accept: text/html) to SPA routes like /mesh or /bots
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
