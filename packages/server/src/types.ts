import type { WebSocket } from "@fastify/websocket";

// --- In-memory state ---

export interface OnlineNode {
  name: string;
  publicKey: string;
  noisePublicKey: string;
  fingerprint: string;
  ws: WebSocket;
  publicIp: string;
  registeredAt: number;
}

export interface PendingInvite {
  token: string;
  inviterName: string;
  inviterPublicKey: string;
  inviterFingerprint: string;
  inviterNoisePublicKey: string;
  expiresAt: number;
  consumed: boolean;
}

export interface RelayPair {
  token: string;
  ws1: WebSocket;
  ws2?: WebSocket;
  createdAt: number;
  timer: ReturnType<typeof setTimeout>;
}

// --- Client → Server messages ---

export type ClientMessage =
  | { type: "register"; name: string; publicKey: string; noisePublicKey: string; fingerprint: string; signature: string; requestId?: string }
  | { type: "unregister" }
  | { type: "signal"; to: string; data: unknown }
  | { type: "request-relay"; peer: string; requestId?: string }
  | { type: "lookup"; peer: string; requestId?: string }
  | { type: "ping" };

// --- Server → Client messages ---

export type ServerMessage =
  | { type: "registered"; ok: true; requestId?: string }
  | { type: "signal"; from: string; data: unknown }
  | { type: "relay-token"; token: string; relayUrl: string; requestId?: string }
  | { type: "invite-accepted"; peer: string; publicKey: string; noisePublicKey: string; fingerprint: string }
  | { type: "pong" }
  | { type: "error"; code: string; message: string; requestId?: string }
  | { type: "lookup-result"; found: boolean; peer?: { name: string; publicKey: string; noisePublicKey: string; fingerprint: string; online: boolean }; requestId?: string };

// --- Config ---

export interface ServerConfig {
  port: number;
  host: string;
  relayUrl: string;
  relayPairTimeoutMs: number;
  relayMaxSessionMs: number;
  relayMaxMessageBytes: number;
  relayMaxPairs: number;
  inviteMaxPending: number;
}

export const DEFAULT_CONFIG: ServerConfig = {
  port: 7680,
  host: "0.0.0.0",
  relayUrl: "wss://relay.mecha.im",
  relayPairTimeoutMs: 60_000,
  relayMaxSessionMs: 3_600_000,
  relayMaxMessageBytes: 65_536,
  relayMaxPairs: 1000,
  inviteMaxPending: 10_000,
};
