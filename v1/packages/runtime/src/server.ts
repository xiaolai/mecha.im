import Fastify, { type FastifyInstance } from "fastify";
import type { MechaId, MechaState } from "@mecha/core";
import type Database from "better-sqlite3";
import { createMcpServer, registerMcpRoutes } from "./mcp/server.js";
import { registerAgentRoutes, type AgentOptions } from "./agent/casa.js";
import { registerSessionRoutes } from "./agent/session-routes.js";
import { SessionManager, resolveProjectDir } from "./agent/session-manager.js";
import { generateToken, createAuthMiddleware } from "./auth/token.js";
import { ConfigStore } from "./config/config-store.js";
import { registerConfigRoutes } from "./config/config-routes.js";

export interface ServerOptions {
  /** Mecha ID for this runtime instance */
  mechaId: MechaId;
  /** Runtime version string */
  version?: string;
  /** Logger configuration */
  logger?: boolean;
  /** Skip MCP server setup (for testing) */
  skipMcp?: boolean;
  /** Agent configuration (omit to disable agent endpoint) */
  agent?: Omit<AgentOptions, "mechaId">;
  /** Auth token — if omitted, one is generated and logged */
  authToken?: string;
  /** OTP shared secret for browser-friendly access */
  otp?: string;
  /** Skip auth middleware (for testing) */
  skipAuth?: boolean;
  /** SQLite database for session persistence */
  db?: Database.Database;
}

export function createServer(opts: ServerOptions): FastifyInstance {
  const startTime = Date.now();
  const getUptime = () => Math.floor((Date.now() - startTime) / 1000);
  const app = Fastify({ logger: opts.logger ?? false });

  // --- auth setup ---
  const token = opts.authToken && opts.authToken.length > 0 ? opts.authToken : generateToken();
  if (!opts.skipAuth) {
    if (!opts.authToken) app.addHook("onReady", () => app.log.info(`Auth token: ${token.slice(0, 8)}…`));
    app.addHook("preHandler", createAuthMiddleware(token, opts.otp));
  }

  app.get("/healthz", async (_req, reply) => reply.send({ status: "ok", uptime: getUptime() }));

  app.get("/info", async (_req, reply) => reply.send({
    id: opts.mechaId, version: opts.version ?? "0.1.0", uptime: getUptime(), state: "running" as MechaState,
  }));

  registerAgentRoutes(app, opts.agent ? { mechaId: opts.mechaId, ...opts.agent } : undefined);

  // --- session management ---
  const agentOpts: AgentOptions | undefined = opts.agent ? { mechaId: opts.mechaId, ...opts.agent } : undefined;
  let sessionManager: SessionManager | undefined;
  if (opts.db && agentOpts) {
    const projectDir = resolveProjectDir(agentOpts.workingDirectory ?? process.cwd());
    sessionManager = new SessionManager(opts.db, agentOpts, projectDir);
    sessionManager.resetBusySessions();
    sessionManager.importTranscripts(projectDir);
    registerSessionRoutes(app, sessionManager, projectDir);
    sessionManager.startCleanup();
    app.addHook("onClose", async () => sessionManager!.shutdown());
  } else {
    // Register routes that return 503 when sessions are unavailable
    registerSessionRoutes(app, undefined);
  }

  // --- config store ---
  const configStore = opts.db ? new ConfigStore(opts.db) : undefined;
  registerConfigRoutes(app, configStore);

  if (!opts.skipMcp) registerMcpRoutes(app, createMcpServer({ mechaId: opts.mechaId, sessionManager }));

  // --- graceful shutdown ---
  /* v8 ignore start */
  const onSignal = async () => { cleanup(); await app.close(); };
  const cleanup = () => { process.removeListener("SIGTERM", onSignal); process.removeListener("SIGINT", onSignal); };
  /* v8 ignore stop */
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
  /* v8 ignore next */
  app.addHook("onClose", async () => cleanup());

  return app;
}
