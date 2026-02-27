import Fastify from "fastify";
import websocket from "@fastify/websocket";
import type { FastifyInstance } from "fastify";
import { registerSignaling, nodes } from "./signaling.js";
import { registerInviteRoutes, invites } from "./invites.js";
import { registerRelay, relayPairs } from "./relay.js";
import { DEFAULT_CONFIG } from "./types.js";
import type { ServerConfig } from "./types.js";

export { nodes } from "./signaling.js";
export { invites } from "./invites.js";
export { relayPairs } from "./relay.js";
export { DEFAULT_CONFIG } from "./types.js";
export type { ServerConfig, OnlineNode, PendingInvite, RelayPair } from "./types.js";

/** Issued relay tokens store. Exported for testing only. */
let _issuedRelayTokens: Set<string> | undefined;
export function getIssuedRelayTokens(): Set<string> | undefined { return _issuedRelayTokens; }

export async function createServer(overrides: Partial<ServerConfig> = {}): Promise<FastifyInstance> {
  const config: ServerConfig = { ...DEFAULT_CONFIG, ...overrides };
  // Initialize relay token store for signaling ↔ relay validation
  if (!config.issuedRelayTokens) {
    config.issuedRelayTokens = new Set();
  }
  _issuedRelayTokens = config.issuedRelayTokens;

  const app = Fastify({
    logger: false,
    trustProxy: config.trustProxy,
  });

  await app.register(websocket);

  // Health check
  app.get("/healthz", async () => ({
    status: "ok",
    nodes: nodes.size,
    invites: invites.size,
    relays: relayPairs.size,
    uptime: process.uptime(),
  }));

  // REST lookup (convenience — also available over WS)
  app.get<{ Params: { name: string } }>("/lookup/:name", async (req, reply) => {
    const node = nodes.get(req.params.name);
    if (!node) {
      return reply.status(404).send({ error: "Node not found", online: false });
    }
    return {
      name: node.name,
      publicKey: node.publicKey,
      noisePublicKey: node.noisePublicKey,
      fingerprint: node.fingerprint,
      online: true,
    };
  });

  registerSignaling(app, config);
  registerInviteRoutes(app, config);
  registerRelay(app, config);

  return app;
}
