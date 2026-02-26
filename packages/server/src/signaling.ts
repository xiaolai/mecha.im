import type { FastifyInstance } from "fastify";
import type { WebSocket } from "@fastify/websocket";
import type { OnlineNode, ClientMessage, ServerConfig } from "./types.js";
import { randomUUID } from "node:crypto";

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

export function registerSignaling(app: FastifyInstance, config: ServerConfig): void {
  app.get("/ws", { websocket: true }, (socket, req) => {
    const clientIp = getClientIp(socket, req);

    socket.on("message", (raw: Buffer | ArrayBuffer | Buffer[]) => {
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

function handleRegister(
  ws: WebSocket,
  clientIp: string,
  msg: Extract<ClientMessage, { type: "register" }>,
): void {
  const { name, publicKey, noisePublicKey, fingerprint, requestId } = msg;

  if (!name || !publicKey || !fingerprint) {
    send(ws, { type: "error", code: "INVALID_REGISTER", message: "Missing required fields", requestId });
    return;
  }

  // Evict previous connection for same name
  const existing = nodes.get(name);
  if (existing && existing.ws !== ws) {
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
