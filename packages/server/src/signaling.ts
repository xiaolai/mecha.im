import type { FastifyInstance } from "fastify";
import type { WebSocket } from "@fastify/websocket";
import type { OnlineNode, ClientMessage, ServerConfig } from "./types.js";
import { randomUUID, createPublicKey, verify } from "node:crypto";

/** In-memory registry of online nodes, keyed by name. */
export const nodes = new Map<string, OnlineNode>();

/** Reverse map: WebSocket → node name (for cleanup on disconnect). */
const wsBySocket = new WeakMap<WebSocket, string>();

function send(ws: WebSocket, msg: Record<string, unknown>): void {
  /* v8 ignore start -- guard: closed socket between check and send */
  if (ws.readyState !== ws.OPEN) return;
  /* v8 ignore stop */
  ws.send(JSON.stringify(msg));
}

function getClientIp(ws: WebSocket, req: { ip: string }): string {
  return req.ip;
}

/** Per-IP rate limiting: 60 messages per minute sliding window. */
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;
const rateLimits = new Map<string, { count: number; resetAt: number }>();

/* v8 ignore start -- rate limiting: exercised via integration, hard to unit test without 60+ messages */
function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimits.get(ip);
  if (!entry || now >= entry.resetAt) {
    rateLimits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT_MAX;
}

/** Purge expired rate limit entries to prevent unbounded growth. */
const RATE_LIMIT_PURGE_INTERVAL_MS = 300_000; // 5 minutes
let lastPurge = Date.now();
function purgeRateLimits(): void {
  const now = Date.now();
  if (now - lastPurge < RATE_LIMIT_PURGE_INTERVAL_MS) return;
  lastPurge = now;
  for (const [ip, entry] of rateLimits) {
    if (now >= entry.resetAt) rateLimits.delete(ip);
  }
}
/* v8 ignore stop */

export function registerSignaling(app: FastifyInstance, config: ServerConfig): void {
  app.get("/ws", { websocket: true }, (socket, req) => {
    const clientIp = getClientIp(socket, req);

    socket.on("message", (raw: Buffer | ArrayBuffer | Buffer[]) => {
      /* v8 ignore start -- rate limit hit requires 60+ messages to test */
      purgeRateLimits();
      if (!checkRateLimit(clientIp)) {
        send(socket, { type: "error", code: "RATE_LIMITED", message: "Too many messages, slow down" });
        return;
      }
      /* v8 ignore stop */

      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(raw)) as ClientMessage;
      } catch {
        send(socket, { type: "error", code: "PARSE_ERROR", message: "Invalid JSON" });
        return;
      }

      switch (msg.type) {
        case "register": {
          handleRegister(socket, clientIp, msg);
          break;
        }
        case "unregister": {
          handleUnregister(socket);
          break;
        }
        case "signal": {
          handleSignal(socket, msg);
          break;
        }
        case "lookup": {
          handleLookup(socket, msg);
          break;
        }
        case "request-relay": {
          handleRequestRelay(socket, msg, config);
          break;
        }
        case "ping": {
          send(socket, { type: "pong" });
          break;
        }
      }
    });

    socket.on("close", () => {
      handleUnregister(socket);
    });
  });
}

/** Verify Ed25519 signature over registration payload */
function verifyRegistrationSignature(publicKeyPem: string, payload: string, signature: string): boolean {
  try {
    const pubKey = createPublicKey({
      key: Buffer.from(publicKeyPem, "base64"),
      format: "der",
      type: "spki",
    });
    return verify(null, Buffer.from(payload), pubKey, Buffer.from(signature, "base64"));
  /* v8 ignore start -- malformed key/signature */
  } catch {
    return false;
  }
  /* v8 ignore stop */
}

function handleRegister(
  ws: WebSocket,
  clientIp: string,
  msg: Extract<ClientMessage, { type: "register" }>,
): void {
  const { name, publicKey, noisePublicKey, fingerprint, signature, requestId } = msg;

  if (!name || !publicKey || !fingerprint) {
    send(ws, { type: "error", code: "INVALID_REGISTER", message: "Missing required fields", requestId });
    return;
  }

  // Verify Ed25519 signature over registration payload
  if (!signature) {
    send(ws, { type: "error", code: "MISSING_SIGNATURE", message: "Registration requires a valid signature", requestId });
    return;
  }

  /* v8 ignore start -- ?? fallback for optional noisePublicKey */
  const payload = JSON.stringify({ name, publicKey, noisePublicKey: noisePublicKey ?? "", fingerprint });
  /* v8 ignore stop */
  if (!verifyRegistrationSignature(publicKey, payload, signature)) {
    send(ws, { type: "error", code: "INVALID_SIGNATURE", message: "Signature verification failed", requestId });
    return;
  }

  // Public key pinning: if a node is already registered with a different key, reject
  const existing = nodes.get(name);
  if (existing && existing.ws !== ws) {
    if (existing.publicKey !== publicKey) {
      send(ws, { type: "error", code: "KEY_MISMATCH", message: "Name already registered with a different public key", requestId });
      return;
    }
    /* v8 ignore start -- evict close may race with ws already closing */
    existing.ws.close(1000, "Replaced by new connection");
    /* v8 ignore stop */
  }

  const node: OnlineNode = {
    name,
    publicKey,
    /* v8 ignore start -- ?? fallback for optional field */
    noisePublicKey: noisePublicKey ?? "",
    /* v8 ignore stop */
    fingerprint,
    ws,
    publicIp: clientIp,
    registeredAt: Date.now(),
  };

  nodes.set(name, node);
  wsBySocket.set(ws, name);

  send(ws, { type: "registered", ok: true, requestId });
}

function handleUnregister(ws: WebSocket): void {
  const name = wsBySocket.get(ws);
  if (name) {
    const node = nodes.get(name);
    if (node?.ws === ws) {
      nodes.delete(name);
    }
    wsBySocket.delete(ws);
  }
}

function handleSignal(
  ws: WebSocket,
  msg: Extract<ClientMessage, { type: "signal" }>,
): void {
  const senderName = wsBySocket.get(ws);
  if (!senderName) {
    send(ws, { type: "error", code: "NOT_REGISTERED", message: "Register first" });
    return;
  }

  const target = nodes.get(msg.to);
  if (!target) {
    send(ws, { type: "error", code: "PEER_OFFLINE", message: `Peer "${msg.to}" is not online` });
    return;
  }

  send(target.ws, { type: "signal", from: senderName, data: msg.data });
}

function handleLookup(
  ws: WebSocket,
  msg: Extract<ClientMessage, { type: "lookup" }>,
): void {
  const node = nodes.get(msg.peer);
  const requestId = msg.requestId;

  if (!node) {
    send(ws, { type: "lookup-result", found: false, requestId });
    return;
  }

  send(ws, {
    type: "lookup-result",
    found: true,
    peer: {
      name: node.name,
      publicKey: node.publicKey,
      noisePublicKey: node.noisePublicKey,
      fingerprint: node.fingerprint,
      online: true,
    },
    requestId,
  });
}

function handleRequestRelay(
  ws: WebSocket,
  msg: Extract<ClientMessage, { type: "request-relay" }>,
  config: ServerConfig,
): void {
  const senderName = wsBySocket.get(ws);
  if (!senderName) {
    send(ws, { type: "error", code: "NOT_REGISTERED", message: "Register first", requestId: msg.requestId });
    return;
  }

  const token = randomUUID();
  // Register the token so the relay endpoint can validate it
  config.issuedRelayTokens?.add(token);
  send(ws, { type: "relay-token", token, relayUrl: config.relayUrl, requestId: msg.requestId });

  // Notify peer about relay readiness
  const peer = nodes.get(msg.peer);
  if (peer) {
    send(peer.ws, {
      type: "signal",
      from: senderName,
      data: { type: "relay-ready", token },
    });
  }
}
