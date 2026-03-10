import Fastify, { type FastifyInstance } from "fastify";
import { MechaError } from "@mecha/core";
import { createSessionManager } from "./session-manager.js";
import { createAuthHook } from "./auth.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerSessionRoutes } from "./routes/sessions.js";
import { registerChatRoutes, type HttpChatFn } from "./routes/chat.js";
import { registerScheduleRoutes } from "./routes/schedule.js";
import { registerMcpRoutes } from "./mcp/server.js";
import { createScheduleEngine, type ChatFn, type ScheduleEngine } from "./scheduler.js";
import { sdkChat, createChatFn } from "./sdk-chat.js";

/** Options for creating a bot runtime Fastify server. */
export interface CreateServerOpts {
  botName: string;
  port: number;
  authToken: string;
  projectsDir: string;
  workspacePath: string;
  mechaDir?: string;
  botDir?: string;
  /** Override the SDK-backed schedule chatFn (for testing). Does not affect /api/chat route. */
  scheduleChatFn?: ChatFn;
}

/** Return value from {@link createServer}: the Fastify app and optional scheduler. */
export interface ServerResult {
  app: FastifyInstance;
  scheduler?: ScheduleEngine;
}

/** Create a fully-configured bot runtime server with auth, sessions, chat, MCP, and scheduling. */
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

  // SDK chat options (used for /api/chat and schedule chatFn)
  const chatOpts = {
    workspacePath: opts.workspacePath,
    settingSources: ["project"] as const,
  };

  // HTTP chat handler for /api/chat route
  /* v8 ignore start -- SDK boundary lambda, tested via chat.test.ts with mock */
  const httpChatFn: HttpChatFn = async (message, sessionId, signal) => {
    return await sdkChat(chatOpts, message, sessionId, signal);
  };
  /* v8 ignore stop */

  // Schedule-compatible chatFn
  const chatFn: ChatFn = opts.scheduleChatFn ?? createChatFn(chatOpts);

  // Routes
  registerHealthRoutes(app, {
    botName: opts.botName,
    port: opts.port,
    startedAt: new Date().toISOString(),
  });
  registerSessionRoutes(app, sm);
  registerChatRoutes(app, httpChatFn);
  registerMcpRoutes(app, {
    workspacePath: opts.workspacePath,
    mechaDir: opts.mechaDir,
    botName: opts.botName,
  });

  // Schedule engine (requires botDir)
  let scheduler: ScheduleEngine | undefined;
  if (opts.botDir) {
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
