import Fastify, { type FastifyInstance } from "fastify";
import { createSessionManager } from "./session-manager.js";
import { createAuthHook } from "./auth.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerSessionRoutes } from "./routes/sessions.js";
import { registerChatRoutes } from "./routes/chat.js";
import { registerScheduleRoutes } from "./routes/schedule.js";
import { registerMcpRoutes } from "./mcp/server.js";
import { createScheduleEngine, type ChatFn, type ScheduleEngine } from "./scheduler.js";

export interface CreateServerOpts {
  casaName: string;
  port: number;
  authToken: string;
  projectsDir: string;
  workspacePath: string;
  mechaDir?: string;
  casaDir?: string;
  chatFn?: ChatFn;
}

export interface ServerResult {
  app: FastifyInstance;
  scheduler?: ScheduleEngine;
}

export function createServer(opts: CreateServerOpts): ServerResult {
  const app = Fastify({
    logger: { redact: ["req.headers.authorization"] },
  });

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
  registerMcpRoutes(app, {
    workspacePath: opts.workspacePath,
    mechaDir: opts.mechaDir,
    casaName: opts.casaName,
  });

  // Schedule engine (requires casaDir)
  let scheduler: ScheduleEngine | undefined;
  if (opts.casaDir) {
    /* v8 ignore start -- default chatFn when chat not wired */
    const chatFn: ChatFn = opts.chatFn ?? (async () => ({
      durationMs: 0,
      error: "Chat not wired yet (501)",
    }));
    /* v8 ignore stop */

    scheduler = createScheduleEngine({
      casaDir: opts.casaDir,
      casaName: opts.casaName,
      chatFn,
    });

    registerScheduleRoutes(app, scheduler);

    // Start scheduler when server is ready
    app.addHook("onReady", async () => {
      scheduler!.start();
    });

    // Stop scheduler on shutdown
    app.addHook("onClose", async () => {
      scheduler!.stop();
    });
  }

  return { app, scheduler };
}
