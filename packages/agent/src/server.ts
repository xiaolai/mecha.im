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
import { createPtyManager } from "./pty-manager.js";

export interface AgentServerOpts {
  port: number;
  apiKey: string;
  processManager: ProcessManager;
  acl: AclEngine;
  mechaDir: string;
  nodeName: string;
  /** Injected PTY spawn function (for terminal WS). Omit to disable terminal. */
  ptySpawnFn?: PtySpawnFn;
}

export function createAgentServer(opts: AgentServerOpts): FastifyInstance {
  const app = Fastify({
    logger: { redact: ["req.headers.authorization", "req.headers['x-mecha-signature']"] },
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
