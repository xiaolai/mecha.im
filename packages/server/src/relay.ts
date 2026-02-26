import type { FastifyInstance } from "fastify";
import type { WebSocket } from "@fastify/websocket";
import type { RelayPair, ServerConfig } from "./types.js";

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

    // Second peer — pair them
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
  return undefined;
}
/* v8 ignore stop */
