import Fastify, { type FastifyInstance } from "fastify";
import { createDatabase } from "./database.js";
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
  dbPath: string;
  transcriptDir: string;
  workspacePath: string;
}

export function createServer(opts: CreateServerOpts): FastifyInstance {
  const app = Fastify();

  // Auth middleware
  app.addHook("onRequest", createAuthHook(opts.authToken));

  // Database + session manager
  const db = createDatabase(opts.dbPath);
  const sm = createSessionManager(db, opts.transcriptDir);

  // Routes
  registerHealthRoutes(app, {
    casaName: opts.casaName,
    port: opts.port,
    startedAt: new Date().toISOString(),
  });
  registerSessionRoutes(app, sm);
  registerChatRoutes(app, sm);
  registerMcpRoutes(app, { workspacePath: opts.workspacePath });

  // Cleanup on close
  app.addHook("onClose", async () => {
    db.close();
  });

  return app;
}
