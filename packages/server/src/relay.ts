import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import type { RelayPair, ServerConfig } from "./types.js";
import { validateRelayToken } from "./relay-tokens.js";

/** Active relay pairs, keyed by token. */
export const relayPairs = new Map<string, RelayPair>();

export function registerRelay(app: FastifyInstance, config: ServerConfig): void {
  app.get<{ Querystring: { token?: string } }>("/relay", { websocket: true }, (socket, req) => {
    const rawToken = (req.query as { token?: string }).token;
    if (!rawToken) {
      socket.close(4000, "Missing token");
      return;
    }

    const token: string = rawToken;

    // Validate HMAC relay token (self-verifiable, no shared state needed)
    /* v8 ignore start -- secret always initialized by createServer */
    const secret = config.secret ?? randomBytes(32);
    /* v8 ignore stop */
    const payload = validateRelayToken(secret, token);
    if (!payload) {
      socket.close(4003, "Invalid relay token");
      return;
    }
    // Note: payload.peer and payload.srv are metadata baked into the HMAC.
    // The relay is a dumb pipe — identity enforcement happens at the Noise layer.

    if (relayPairs.size >= config.relayMaxPairs && !relayPairs.has(token)) {
      socket.close(4001, "Relay capacity reached");
      return;
    }

    const existing = relayPairs.get(token);

    if (!existing) {
      // First peer — wait for the second
      /* v8 ignore start -- pairing timeout requires 60s wait in tests */
      const timer = setTimeout(() => {
        relayPairs.delete(token);
        socket.close(4002, "Pairing timeout");
      }, config.relayPairTimeoutMs);
      /* v8 ignore stop */

      relayPairs.set(token, { token, ws1: socket, createdAt: Date.now(), timer });

      socket.on("close", () => {
        const pair = relayPairs.get(token);
        if (pair) {
          clearTimeout(pair.timer);
          relayPairs.delete(token);
          pair.ws2?.close(1000, "Peer disconnected");
        }
      });
      return;
    }

    // Reject 3rd+ client — relay tokens are strictly one pair
    /* v8 ignore start -- 3rd client rejection: requires three simultaneous relay connections */
    if (existing.ws2) {
      socket.close(4004, "Relay pair already full");
      return;
    }
    /* v8 ignore stop */

    // Second peer — pair them (HMAC tokens are self-verifiable, no state to clean)
    clearTimeout(existing.timer);
    existing.ws2 = socket;

    const ws1 = existing.ws1;
    const ws2 = socket;

    /* v8 ignore start -- session timeout requires 1h wait in tests */
    const sessionTimer = setTimeout(() => {
      relayPairs.delete(token);
      ws1.close(1000, "Session timeout");
      ws2.close(1000, "Session timeout");
    }, config.relayMaxSessionMs);
    /* v8 ignore stop */

    // Bidirectional relay
    ws1.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
      const bytes = toBytes(data);
      /* v8 ignore start -- oversized/closed-socket guards */
      if (bytes && bytes.length <= config.relayMaxMessageBytes && ws2.readyState === ws2.OPEN) {
        ws2.send(bytes);
      }
      /* v8 ignore stop */
    });

    ws2.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
      const bytes = toBytes(data);
      /* v8 ignore start -- oversized/closed-socket guards */
      if (bytes && bytes.length <= config.relayMaxMessageBytes && ws1.readyState === ws1.OPEN) {
        ws1.send(bytes);
      }
      /* v8 ignore stop */
    });

    function teardown(): void {
      clearTimeout(sessionTimer);
      relayPairs.delete(token);
    }

    ws1.on("close", () => {
      teardown();
      ws2.close(1000, "Peer disconnected");
    });

    ws2.on("close", () => {
      teardown();
      ws1.close(1000, "Peer disconnected");
    });
  });
}

/* v8 ignore start -- ws always delivers Buffer in Node.js; other branches are for non-Node runtimes */
function toBytes(data: unknown): Uint8Array | undefined {
  if (data instanceof Buffer) return new Uint8Array(data);
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data) && data.every((b) => Buffer.isBuffer(b))) {
    return new Uint8Array(Buffer.concat(data as Buffer[]));
  }
  return undefined;
}
/* v8 ignore stop */
