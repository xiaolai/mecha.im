import Fastify, { type FastifyInstance } from "fastify";
import type { AclEngine } from "@mecha/core";
import type { ProcessManager } from "@mecha/process";
import { createAuthHook } from "./auth.js";
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
  const app = Fastify({ logger: true });

  app.addHook("onRequest", createAuthHook({ apiKey: opts.apiKey }));

  registerHealthRoutes(app, { nodeName: opts.nodeName, port: opts.port });
  registerCasaRoutes(app, opts.processManager);
  registerRoutingRoutes(app, { mechaDir: opts.mechaDir, acl: opts.acl });
  registerDiscoverRoutes(app, { mechaDir: opts.mechaDir, pm: opts.processManager });

  return app;
}
