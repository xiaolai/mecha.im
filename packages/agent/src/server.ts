import Fastify, { type FastifyInstance } from "fastify";
import fastifyWebSocket from "@fastify/websocket";
import { type AclEngine, MechaError, readNodes, verifySignature } from "@mecha/core";
import type { ProcessManager, PtySpawnFn } from "@mecha/process";
import { createAuthHook, createSignatureHook } from "./auth.js";
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
import { createPtyManager } from "./pty-manager.js";
import { issueTicket, consumeTicket, purgeTickets } from "./ws-tickets.js";

export interface AgentServerOpts {
  port: number;
  apiKey: string;
  processManager: ProcessManager;
  acl: AclEngine;
  mechaDir: string;
  nodeName: string;
  /** Injected PTY spawn function (for terminal WS). Omit to disable terminal. */
  ptySpawnFn?: PtySpawnFn;
  /** Path to SPA dist directory. When set, serves static SPA files. */
  spaDir?: string;
}

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

  // Build node public key map for signature verification
  const nodePublicKeys = new Map<string, string>();
  /* v8 ignore start -- node registry + signature wiring tested in mesh E2E */
  try {
    const nodes = readNodes(opts.mechaDir);
    for (const node of nodes) {
      if (node.publicKey) nodePublicKeys.set(node.name, node.publicKey);
    }
  } catch (err) {
    app.log.warn("Failed to read nodes.json — signature verification disabled: %s",
      err instanceof Error ? err.message : String(err));
  }

  const authOpts = {
    apiKey: opts.apiKey,
    nodePublicKeys: nodePublicKeys.size > 0 ? nodePublicKeys : undefined,
    verifySignature: nodePublicKeys.size > 0 ? verifySignature : undefined,
    spaDir: opts.spaDir,
  };

  app.addHook("onRequest", createAuthHook(authOpts));
  // Signature hook runs in preHandler (after body parsing) so request.body is available
  app.addHook("preHandler", createSignatureHook(authOpts));
  /* v8 ignore stop */

  registerHealthRoutes(app, { nodeName: opts.nodeName, port: opts.port });
  registerCasaRoutes(app, opts.processManager);
  registerRoutingRoutes(app, { mechaDir: opts.mechaDir, acl: opts.acl });
  registerDiscoverRoutes(app, { mechaDir: opts.mechaDir, pm: opts.processManager });
  registerSessionRoutes(app, opts.processManager);
  registerAclRoutes(app, { acl: opts.acl });
  registerAuditRoutes(app, { mechaDir: opts.mechaDir });
  registerMeshRoutes(app, { mechaDir: opts.mechaDir });
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
function registerSpaRoutes(app: FastifyInstance, spaDir: string): void {
  // Use app.register with async plugin so Fastify awaits it before listen()
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
    // SPA fallback: non-API GET requests → index.html for client-side routing
    if (request.method === "GET") {
      const p = request.url.split("?")[0]!;
      const isApi = p.startsWith("/casas") || p.startsWith("/acl") ||
        p.startsWith("/audit") || p.startsWith("/mesh") ||
        p.startsWith("/meter") || p.startsWith("/settings") ||
        p.startsWith("/events") || p.startsWith("/discover") ||
        p.startsWith("/ws") || p === "/healthz";
      if (!isApi) {
        return reply.sendFile("index.html");
      }
    }
    reply.code(404).send({ error: "Not found" });
  });
}
/* v8 ignore stop */
