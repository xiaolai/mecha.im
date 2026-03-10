import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { registerSignaling, nodes } from "./signaling.js";
import { registerInviteRoutes } from "./invites.js";
import { registerRelay } from "./relay.js";
import { registerGossip } from "./gossip.js";
import { createGossipCache } from "./gossip-cache.js";
import { DEFAULT_CONFIG } from "./types.js";
import type { ServerConfig } from "./types.js";
import type { PeerRecord } from "./gossip-cache.js";

export { nodes } from "./signaling.js";
export { invites } from "./invites.js";
export { relayPairs } from "./relay.js";
export { DEFAULT_CONFIG } from "./types.js";
export type { ServerConfig, OnlineNode, PendingInvite, RelayPair } from "./types.js";
export type { RelayTokenPayload } from "./relay-tokens.js";
export { createRelayToken, validateRelayToken } from "./relay-tokens.js";
export { createGossipCache } from "./gossip-cache.js";
export type { PeerRecord, GossipCache } from "./gossip-cache.js";
export type { VectorClock } from "./vector-clock.js";
export { increment, merge, isNewer, diff } from "./vector-clock.js";
export type { GossipMessage } from "./gossip.js";

export async function createServer(overrides: Partial<ServerConfig> = {}): Promise<FastifyInstance> {
  const config: ServerConfig = { ...DEFAULT_CONFIG, ...overrides };
  // Generate ephemeral HMAC secret for self-verifiable relay tokens
  if (!config.secret) {
    config.secret = randomBytes(32);
  }

  const gossipCache = createGossipCache();

  const app = Fastify({
    logger: false,
    trustProxy: config.trustProxy,
  });

  await app.register(websocket);

  // Health check — only expose status, not operational details
  app.get("/healthz", async () => ({
    status: "ok",
  }));

  // REST lookup (convenience — also available over WS)
  app.get<{ Params: { name: string } }>("/lookup/:name", async (req, reply) => {
    const node = nodes.get(req.params.name);
    if (!node) {
      // Check gossip cache
      const gossipRecord = gossipCache.lookup(req.params.name);
      if (gossipRecord) {
        return {
          name: gossipRecord.name,
          publicKey: gossipRecord.publicKey,
          noisePublicKey: gossipRecord.noisePublicKey,
          fingerprint: gossipRecord.fingerprint,
          online: true,
        };
      }
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

  registerSignaling(app, config, gossipCache);
  registerInviteRoutes(app, config);
  registerRelay(app, config);

  // Register gossip if mechaDir is provided (needed for peer validation)
  if (config.mechaDir) {
    // Lazy import to avoid circular dependency
    const { readNodes } = await import("@mecha/core");
    // Use loopback for non-routable bind addresses (0.0.0.0, ::)
    const advertiseHost = config.host === "0.0.0.0" || config.host === "::" ? "127.0.0.1" : config.host;
    const serverId = advertiseHost + ":" + config.port;

    // Cache node keys in memory to avoid sync disk reads on every auth check
    let cachedNodeKeys = new Map<string, string>();
    let cacheTime = 0;
    const CACHE_TTL_MS = 30_000;
    function lookupPeerKey(name: string): string | undefined {
      const now = Date.now();
      if (now - cacheTime > CACHE_TTL_MS) {
        cachedNodeKeys = new Map(
          readNodes(config.mechaDir!).flatMap((n) => n.publicKey ? [[n.name, n.publicKey] as const] : []),
        );
        cacheTime = now;
      }
      return cachedNodeKeys.get(name);
    }

    registerGossip(app, {
      config,
      gossipCache,
      lookupPeerKey,
      getLocalRecords: (): PeerRecord[] => {
        const now = Math.floor(Date.now() / 1000);
        const records: PeerRecord[] = [];
        for (const node of nodes.values()) {
          records.push({
            name: node.name,
            publicKey: node.publicKey,
            noisePublicKey: node.noisePublicKey,
            fingerprint: node.fingerprint,
            serverUrl: `ws://${advertiseHost}:${config.port}`,
            lastSeen: now,
            hopCount: 0,
          });
        }
        return records;
      },
      serverId,
    });
  }

  return app;
}
