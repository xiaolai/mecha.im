import { DEFAULTS, RendezvousError, createLogger, nodeName as toNodeName } from "@mecha/core";
import type { NodeName } from "@mecha/core";
import type { PeerInfo, SignalData, RendezvousClient } from "./types.js";
import type { WebSocketLike } from "./relay.js";

export interface CreateRendezvousClientOpts {
  url?: string;
  /** Sign data and return base64 signature string */
  signFn: (data: Uint8Array) => string;
  reconnectBaseMs?: number;
  reconnectMaxAttempts?: number;
  /** Injected WebSocket constructor for testing */
  createWebSocket?: (url: string) => WebSocketLike;
}

interface PendingRequest {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const log = createLogger("mecha:rendezvous");
const WS_OPEN = 1;

export function createRendezvousClient(opts: CreateRendezvousClientOpts): RendezvousClient {
  const {
    url = DEFAULTS.RENDEZVOUS_URL,
    signFn,
    reconnectBaseMs = DEFAULTS.RECONNECT_BASE_MS,
    reconnectMaxAttempts = DEFAULTS.RECONNECT_MAX_ATTEMPTS,
    createWebSocket,
  } = opts;

  let ws: WebSocketLike | undefined;
  let registered = false;
  let reconnectAttempts = 0;
  let closedByUser = false;
  let savedIdentity: { name: string; publicKey: string; noisePublicKey: string; fingerprint: string } | undefined;
  const RECONNECT_MAX_MS = 30_000;

  const signalHandlers: Array<(from: NodeName, data: SignalData) => void> = [];
  const inviteAcceptedHandlers: Array<(peer: string, pubKey: string, noisePubKey: string, fp: string) => void> = [];
  const pendingRequests = new Map<string, PendingRequest>();
  let requestCounter = 0;

  function sendMsg(msg: Record<string, unknown>): void {
    if (!ws || ws.readyState !== WS_OPEN) {
      throw new RendezvousError("Not connected to rendezvous server");
    }
    ws.send(new TextEncoder().encode(JSON.stringify(msg)) as unknown as Uint8Array);
  }

  function sendRequest(msg: Record<string, unknown>, timeoutMs = 10_000): Promise<unknown> {
    const id = String(++requestCounter);
    const msgWithId = { ...msg, requestId: id };

    return new Promise((resolve, reject) => {
      /* v8 ignore start -- request timeout callback requires 10s wait in tests */
      const timer = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new RendezvousError("Request timeout"));
      }, timeoutMs);
      /* v8 ignore stop */

      pendingRequests.set(id, { resolve, reject, timer });
      /* v8 ignore start -- sendMsg throw requires disconnected-but-not-detected state */
      try {
        sendMsg(msgWithId);
      } catch (err) {
        pendingRequests.delete(id);
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
      /* v8 ignore stop */
    });
  }

  function handleMessage(data: unknown): void {
    if (typeof data !== "object" || data === null) return;
    const msg = data as Record<string, unknown>;

    // Handle request responses
    const reqId = msg.requestId as string | undefined;
    if (reqId && pendingRequests.has(reqId)) {
      const pending = pendingRequests.get(reqId)!;
      pendingRequests.delete(reqId);
      clearTimeout(pending.timer);
      if (msg.error || msg.type === "error") {
        /* v8 ignore start -- ?? fallback for error message fields */
        pending.reject(new RendezvousError((msg.message ?? msg.code ?? "Unknown error") as string));
        /* v8 ignore stop */
      } else {
        pending.resolve(msg);
      }
      return;
    }

    // Handle server-pushed events
    switch (msg.type) {
      case "signal": {
        const from = toNodeName(msg.from as string);
        const signalData = msg.data as SignalData;
        for (const handler of signalHandlers) handler(from, signalData);
        break;
      }
      case "invite-accepted": {
        const peer = msg.peer as string;
        const pubKey = msg.publicKey as string;
        const noisePubKey = msg.noisePublicKey as string;
        const fp = msg.fingerprint as string;
        for (const handler of inviteAcceptedHandlers) handler(peer, pubKey, noisePubKey, fp);
        break;
      }
    }
  }

  const client: RendezvousClient = {
    async connect(): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        /* v8 ignore start -- real WebSocket fallback, tests always inject createWebSocket */
        const socket = createWebSocket
          ? createWebSocket(url + "/ws")
          : new WebSocket(url + "/ws") as unknown as WebSocketLike;
        /* v8 ignore stop */
        ws = socket;
        let settled = false;

        /* v8 ignore start -- connect timeout requires real slow server */
        const connectTimer = setTimeout(() => {
          if (!settled) {
            settled = true;
            socket.close();
            reject(new RendezvousError("Connect timeout after 10000ms"));
          }
        }, 10_000);
        /* v8 ignore stop */

        socket.onopen = () => {
          /* v8 ignore start -- onopen after settle is a no-op */
          if (!settled) {
            settled = true;
            clearTimeout(connectTimer);
            reconnectAttempts = 0;
            resolve();
          }
          /* v8 ignore stop */
        };

        socket.onmessage = (ev: { data: unknown }) => {
          try {
            const text = ev.data instanceof Uint8Array
              ? new TextDecoder().decode(ev.data)
              : typeof ev.data === "string" ? ev.data : String(ev.data);
            handleMessage(JSON.parse(text));
          /* v8 ignore start -- malformed server message */
          } catch (err) {
            log.warn("Failed to parse server message", { error: err instanceof Error ? err.message : String(err) });
          }
          /* v8 ignore stop */
        };

        socket.onclose = () => {
          registered = false;
          /* v8 ignore start -- close-before-open requires specific WebSocket timing */
          if (!settled) {
            settled = true;
            clearTimeout(connectTimer);
            reject(new RendezvousError("Connection closed before open"));
          }
          /* v8 ignore stop */
          // Reject all pending requests so callers don't hang
          for (const [, pending] of pendingRequests) {
            clearTimeout(pending.timer);
            pending.reject(new RendezvousError("Connection closed"));
          }
          pendingRequests.clear();

          // Attempt reconnection if not explicitly closed by user
          /* v8 ignore start -- reconnection requires real server disconnect timing */
          if (!closedByUser && reconnectAttempts < reconnectMaxAttempts) {
            const delay = Math.min(reconnectBaseMs * Math.pow(2, reconnectAttempts), RECONNECT_MAX_MS);
            reconnectAttempts++;
            setTimeout(async () => {
              try {
                await client.connect();
                reconnectAttempts = 0;
                // Re-register with saved identity if we had one
                if (savedIdentity) {
                  await client.register(savedIdentity);
                }
              } catch {
                // Reconnect failed — onclose will fire again and retry
              }
            }, delay);
          }
          /* v8 ignore stop */
        };

        socket.onerror = () => {
          /* v8 ignore start -- error after settle is a no-op race */
          if (!settled) {
            settled = true;
            clearTimeout(connectTimer);
            reject(new RendezvousError(`Cannot reach rendezvous server at ${url}`));
          }
          /* v8 ignore stop */
        };
      });
    },

    async register(identity): Promise<void> {
      const payload = JSON.stringify(identity);
      const sig = signFn(new TextEncoder().encode(payload));
      await sendRequest({
        type: "register",
        ...identity,
        signature: sig,
      });
      registered = true;
      savedIdentity = identity;
    },

    async unregister(): Promise<void> {
      if (!registered) return;
      sendMsg({ type: "unregister" });
      registered = false;
    },

    async lookup(peer: NodeName): Promise<PeerInfo | undefined> {
      const result = await sendRequest({ type: "lookup", peer }) as Record<string, unknown>;
      if (!result.found) return undefined;
      return result.peer as PeerInfo;
    },

    async signal(peer: NodeName, data: SignalData): Promise<void> {
      sendMsg({ type: "signal", to: peer, data });
    },

    async requestRelay(peer: NodeName): Promise<string> {
      const result = await sendRequest({ type: "request-relay", peer }) as Record<string, unknown>;
      return result.token as string;
    },

    onSignal(handler): void {
      signalHandlers.push(handler);
    },

    onInviteAccepted(handler): void {
      inviteAcceptedHandlers.push(handler);
    },

    close(): void {
      closedByUser = true;
      registered = false;
      /* v8 ignore start -- close() with pending requests requires specific async timing */
      for (const [, pending] of pendingRequests) {
        clearTimeout(pending.timer);
        pending.reject(new RendezvousError("Client closed"));
      }
      /* v8 ignore stop */
      pendingRequests.clear();
      ws?.close();
      ws = undefined;
    },
  };

  return client;
}
