// @mecha/runtime — standalone Fastify server for each CASA process
// Phase 1: auth, sessions, chat SSE, workspace MCP

export { createDatabase, runMigrations } from "./database.js";
export type { Database } from "./database.js";
export { createSessionManager } from "./session-manager.js";
export type {
  SessionManager,
  SessionMeta,
  SessionMessage,
  Session,
  CreateSessionOpts,
} from "./session-manager.js";
