import Fastify, { type FastifyInstance } from "fastify";
import { type AclEngine, readNodes, verifySignature } from "@mecha/core";
import type { ProcessManager } from "@mecha/process";
import { createAuthHook, createSignatureHook } from "./auth.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerCasaRoutes } from "./routes/casas.js";
import { registerRoutingRoutes } from "./routes/routing.js";
import { registerDiscoverRoutes } from "./routes/discover.js";

export interface AgentServerOpts {
  port: number;
  apiKey: string;
  processManager: ProcessManager;
  acl: AclEngine;
  mechaDir: string;
  nodeName: string;
}

export function createAgentServer(opts: AgentServerOpts): FastifyInstance {
  const app = Fastify({
    logger: { redact: ["req.headers.authorization", "req.headers['x-mecha-signature']"] },
  });

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

  return app;
}
