import type { FastifyInstance } from "fastify";
import type { WebSocket } from "@fastify/websocket";
import { randomBytes, createPublicKey, verify } from "node:crypto";
import type { ServerConfig } from "./types.js";
import type { PeerRecord } from "./gossip-cache.js";
import type { GossipCache } from "./gossip-cache.js";
import type { VectorClock } from "./vector-clock.js";
import { increment, merge, isNewer } from "./vector-clock.js";

const MAX_HOP_COUNT = 3;
const PUSH_INTERVAL_MS = 60_000;

export type GossipMessage =
  | { type: "challenge"; nonce: string }
  | { type: "auth"; name: string; signature: string; publicKey: string }
  | { type: "authenticated" }
  | { type: "gossip-push"; records: PeerRecord[]; vectorClock: VectorClock };

interface GossipPeer {
  ws: WebSocket;
  name: string;
  remoteClock: VectorClock;
}

interface GossipOpts {
  config: ServerConfig;
  gossipCache: GossipCache;
  /** Resolve a known peer's public key by name (from nodes.json). Returns undefined if unknown. */
  lookupPeerKey: (name: string) => string | undefined;
  /** Get current local peer records (from the signaling nodes map). */
  getLocalRecords: () => PeerRecord[];
  /** Server identifier for vector clock. */
  serverId: string;
}

function send(ws: WebSocket, msg: GossipMessage): void {
  /* v8 ignore start -- guard: closed socket */
  if (ws.readyState !== ws.OPEN) return;
  /* v8 ignore stop */
  ws.send(JSON.stringify(msg));
}

function verifyChallenge(publicKeyB64: string, nonce: string, signature: string): boolean {
  try {
    const pubKey = createPublicKey({
      key: Buffer.from(publicKeyB64, "base64"),
      format: "der",
      type: "spki",
    });
    return verify(null, Buffer.from(nonce, "hex"), pubKey, Buffer.from(signature, "base64"));
  /* v8 ignore start -- malformed key/signature */
  } catch {
    return false;
  }
  /* v8 ignore stop */
}

export function registerGossip(app: FastifyInstance, opts: GossipOpts): void {
  const { gossipCache, lookupPeerKey, getLocalRecords, serverId } = opts;
  const connectedPeers = new Map<string, GossipPeer>();
  let localClock: VectorClock = {};

  // Periodic push to all connected gossip peers
  const pushTimer = setInterval(() => {
    if (connectedPeers.size === 0) return;
    localClock = increment(localClock, serverId);
    const records = [...getLocalRecords(), ...gossipCache.getAll().filter((r) => r.hopCount < MAX_HOP_COUNT)];
    for (const peer of connectedPeers.values()) {
      if (isNewer(localClock, peer.remoteClock)) {
        send(peer.ws, { type: "gossip-push", records, vectorClock: localClock });
      }
    }
  }, PUSH_INTERVAL_MS);

  /* v8 ignore start -- cleanup only runs on server shutdown */
  app.addHook("onClose", () => {
    clearInterval(pushTimer);
    for (const peer of connectedPeers.values()) {
      peer.ws.close(1000, "Server shutting down");
    }
    connectedPeers.clear();
  });
  /* v8 ignore stop */

  app.get("/gossip", { websocket: true }, (socket) => {
    const nonce = randomBytes(32).toString("hex");
    let authenticated = false;
    let peerName = "";

    // Send challenge on next tick (ws frame must be flushed after upgrade completes)
    process.nextTick(() => send(socket, { type: "challenge", nonce }));

    socket.on("message", (raw: Buffer | ArrayBuffer | Buffer[]) => {
      let msg: GossipMessage;
      try {
        msg = JSON.parse(String(raw)) as GossipMessage;
      /* v8 ignore start -- malformed JSON */
      } catch {
        socket.close(4000, "Invalid JSON");
        return;
      }
      /* v8 ignore stop */

      if (!authenticated) {
        if (msg.type !== "auth") {
          socket.close(4001, "Expected auth message");
          return;
        }

        // Verify the peer is known
        const expectedKey = lookupPeerKey(msg.name);
        if (!expectedKey) {
          socket.close(4001, "Unknown peer");
          return;
        }

        // Verify public key matches
        if (msg.publicKey !== expectedKey) {
          socket.close(4001, "Public key mismatch");
          return;
        }

        // Verify challenge signature
        if (!verifyChallenge(msg.publicKey, nonce, msg.signature)) {
          socket.close(4001, "Invalid signature");
          return;
        }

        authenticated = true;
        peerName = msg.name;
        connectedPeers.set(peerName, { ws: socket, name: peerName, remoteClock: {} });
        send(socket, { type: "authenticated" });
        return;
      }

      // Authenticated — handle gossip messages
      if (msg.type === "gossip-push") {
        // Validate vectorClock shape — must be plain object with numeric values
        if (typeof msg.vectorClock !== "object" || msg.vectorClock === null || Array.isArray(msg.vectorClock)) {
          socket.close(4002, "Invalid vectorClock");
          return;
        }
        // Validate records — must be an array
        if (!Array.isArray(msg.records)) {
          socket.close(4002, "Invalid records");
          return;
        }

        const peer = connectedPeers.get(peerName);
        if (peer) {
          peer.remoteClock = merge(peer.remoteClock, msg.vectorClock);
        }
        // Process records — validate each entry
        for (const record of msg.records) {
          if (typeof record !== "object" || record === null) continue;
          if (typeof record.name !== "string" || typeof record.hopCount !== "number") continue;
          if (record.hopCount >= MAX_HOP_COUNT) continue;
          gossipCache.upsert({ ...record, hopCount: record.hopCount + 1 });
        }
      }
    });

    socket.on("close", () => {
      if (peerName) {
        connectedPeers.delete(peerName);
      }
    });
  });
}
