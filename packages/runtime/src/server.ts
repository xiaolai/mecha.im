import Fastify, { type FastifyInstance } from "fastify";
import { createSessionManager } from "./session-manager.js";
import { createAuthHook } from "./auth.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerSessionRoutes } from "./routes/sessions.js";
import { registerChatRoutes } from "./routes/chat.js";
import { registerMcpRoutes } from "./mcp/server.js";

export interface CreateServerOpts {
  casaName: string;
  port: number;
  authToken: string;
  projectsDir: string;
  workspacePath: string;
}

export function createServer(opts: CreateServerOpts): FastifyInstance {
  const app = Fastify();

  // Auth middleware
  app.addHook("onRequest", createAuthHook(opts.authToken));

  // Session manager (filesystem-only)
  const sm = createSessionManager(opts.projectsDir);

  // Routes
  registerHealthRoutes(app, {
    casaName: opts.casaName,
    port: opts.port,
    startedAt: new Date().toISOString(),
  });
  registerSessionRoutes(app, sm);
  registerChatRoutes(app);
  registerMcpRoutes(app, { workspacePath: opts.workspacePath });

  return app;
}
