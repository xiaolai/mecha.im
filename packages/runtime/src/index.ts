// @mecha/runtime — standalone Fastify server for each bot process
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
export type { HttpChatFn } from "./routes/chat.js";
export { registerMcpRoutes } from "./mcp/server.js";
export type { McpRouteOpts } from "./mcp/server.js";
export type { MeshRouter } from "./mcp/mesh-tools.js";
export { parseRuntimeEnv } from "./env.js";
export type { RuntimeEnvData } from "./env.js";
export { createServer } from "./server.js";
export type { CreateServerOpts, ServerResult } from "./server.js";
export { createScheduleEngine } from "./scheduler.js";
export type { ScheduleEngine, ChatFn, CreateScheduleEngineOpts, ScheduleLog } from "./scheduler.js";
export { executeRun } from "./schedule-runner.js";
export type { RunDeps } from "./schedule-runner.js";
export { registerScheduleRoutes } from "./routes/schedule.js";
export { sdkChat, createChatFn } from "./sdk-chat.js";
export type { SdkChatOpts } from "./sdk-chat.js";
