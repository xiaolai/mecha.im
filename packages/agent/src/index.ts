export { createAgentServer } from "./server.js";
export type { AgentServerOptions } from "./server.js";

export { startMeterDaemon } from "./meter.js";

export { deriveSessionKey, createSessionToken, validateSessionToken } from "./session.js";

export { createAuthHook, createAuthContext, verifyRequestSignature } from "./auth.js";
export type { AuthConfig, AuthContext } from "./auth.js";

export { registerTaskRoutes } from "./task-routes.js";
export type { TaskRouteOpts } from "./task-routes.js";

export { runDiscoveryScan, startDiscoveryLoop, SCAN_INTERVAL_MS } from "./discovery.js";
