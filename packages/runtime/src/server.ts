import Fastify, { type FastifyInstance } from "fastify";
import { MechaError } from "@mecha/core";
import { createSessionManager } from "./session-manager.js";
import { createAuthHook } from "./auth.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerSessionRoutes } from "./routes/sessions.js";
import { registerChatRoutes } from "./routes/chat.js";
import { registerScheduleRoutes } from "./routes/schedule.js";
import { registerMcpRoutes } from "./mcp/server.js";
import { createScheduleEngine, type ChatFn, type ScheduleEngine } from "./scheduler.js";

export interface CreateServerOpts {
  botName: string;
  port: number;
  authToken: string;
  projectsDir: string;
  workspacePath: string;
  mechaDir?: string;
  botDir?: string;
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

  // Auth middleware
  app.addHook("onRequest", createAuthHook(opts.authToken));

  // Session manager (filesystem-only)
  const sm = createSessionManager(opts.projectsDir);

  // Routes
  registerHealthRoutes(app, {
    botName: opts.botName,
    port: opts.port,
    startedAt: new Date().toISOString(),
  });
  registerSessionRoutes(app, sm);
  registerChatRoutes(app);
  registerMcpRoutes(app, {
    workspacePath: opts.workspacePath,
    mechaDir: opts.mechaDir,
    botName: opts.botName,
  });

  // Schedule engine (requires botDir)
  let scheduler: ScheduleEngine | undefined;
  if (opts.botDir) {
    /* v8 ignore start -- default chatFn when chat not wired */
    const chatFn: ChatFn = opts.chatFn ?? (async () => ({
      durationMs: 0,
      error: "Chat not wired yet (501)",
    }));
    /* v8 ignore stop */

    scheduler = createScheduleEngine({
      botDir: opts.botDir,
      botName: opts.botName,
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
