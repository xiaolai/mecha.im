// @mecha/runtime — standalone Fastify server for each CASA process
// Phase 1: auth, read-only sessions, workspace MCP (chat via Agent SDK)

export { createSessionManager } from "./session-manager.js";
export type {
  SessionManager,
  SessionMeta,
  TranscriptEvent,
  Session,
} from "./session-manager.js";
export { createAuthHook } from "./auth.js";
export { registerHealthRoutes } from "./routes/health.js";
export type { HealthRouteOpts } from "./routes/health.js";
export { registerSessionRoutes } from "./routes/sessions.js";
export { registerChatRoutes } from "./routes/chat.js";
export { registerMcpRoutes } from "./mcp/server.js";
export type { McpRouteOpts } from "./mcp/server.js";
export { createServer } from "./server.js";
export type { CreateServerOpts } from "./server.js";
