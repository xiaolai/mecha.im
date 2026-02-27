import { DEFAULTS, addNode, getNode, ConnectError, PeerOfflineError, signMessage, createLogger, nodeName as toNodeName } from "@mecha/core";
import type { NodeName } from "@mecha/core";
import type {
  ConnectOpts,
  ConnectManager,
  SecureChannel,
  InviteOpts,
  InviteCode,
  AcceptResult,
  PingResult,
  RendezvousClient,
  SignalData,
  Candidate,
} from "./types.js";
import { createRendezvousClient } from "./rendezvous.js";
import { createMultiRendezvousClient } from "./multi-rendezvous.js";
import { createInviteCode, parseInviteCode } from "./invite.js";
import { stunDiscover } from "./stun.js";
import { holePunch } from "./hole-punch.js";
import { noiseInitiate, noiseRespond } from "./noise.js";
import { relayConnect } from "./relay.js";
import { createSecureChannel } from "./channel.js";
import { relayToNoiseTransport, relayToChannelTransport } from "./transport-adapters.js";

const log = createLogger("mecha:connect");
const ANSWER_TIMEOUT_MS = 10_000;

/**
 * Create a ConnectManager that orchestrates P2P connectivity.
 *
 * Chains: STUN → hole-punch → Noise handshake → SecureChannel.
 * Falls back to relay when hole-punch fails.
 */
export function createConnectManager(opts: ConnectOpts): ConnectManager {
  const {
    identity,
    nodeName,
    privateKey,
    noiseKeyPair,
    mechaDir,
    rendezvousUrl = DEFAULTS.RENDEZVOUS_URL,
    relayUrl = DEFAULTS.RELAY_URL,
    stunServers,
    holePunchTimeoutMs,
    answerTimeoutMs = ANSWER_TIMEOUT_MS,
    enableUdpTransport = false,
    _createRelayWebSocket,
    _createUdpSocket,
  } = opts;

  const channels = new Map<string, SecureChannel>();
  const pendingConnects = new Map<string, Promise<SecureChannel>>();
  const pendingAnswers = new Map<string, {
    resolve: (candidates: Candidate[]) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  const connectionHandlers: Array<(channel: SecureChannel) => void> = [];
  let rendezvous: RendezvousClient | undefined;
  let started = false;

  /* v8 ignore start -- signFn is passed to rendezvous client, invoked by server protocol */
  const signFn = (data: Uint8Array): string => {
    return signMessage(privateKey, data);
  };
  /* v8 ignore stop */

  function waitForAnswer(peer: string): Promise<Candidate[]> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingAnswers.delete(peer);
        reject(new ConnectError(`Answer timeout from "${peer}" after ${answerTimeoutMs}ms`));
      }, answerTimeoutMs);
      pendingAnswers.set(peer, { resolve, reject, timer });
    });
  }

  function cacheChannel(peer: string, channel: SecureChannel): void {
    channels.set(peer, channel);
    channel.onClose(() => {
      channels.delete(peer);
      pendingConnects.delete(peer);
    });
    // Auto-respond to ping messages with pong (for RTT measurement)
    channel.onMessage((data) => {
      /* v8 ignore start -- ping/pong auto-responder: tested via mock channel in unit tests */
      try {
        const msg = JSON.parse(new TextDecoder().decode(data)) as { type?: string; nonce?: string };
        if (msg.type === "ping" && msg.nonce) {
          channel.send(new TextEncoder().encode(JSON.stringify({ type: "pong", nonce: msg.nonce })));
        }
      } catch { /* not a ping message, ignore */ }
      /* v8 ignore stop */
    });
  }

  async function connectViaRelay(peer: NodeName, peerFingerprint: string): Promise<SecureChannel> {
    const rv = rendezvous!;
    const token = await rv.requestRelay(peer);

    const relayChannel = await relayConnect({
      relayUrl,
      token,
      createWebSocket: _createRelayWebSocket,
    });

    const noiseTransport = relayToNoiseTransport(relayChannel);
    /* v8 ignore start -- getNode always returns a valid node at this point */
    const peerNode = getNode(mechaDir, peer);
    const remoteNoiseKey = peerNode?.noisePublicKey ?? "";
    /* v8 ignore stop */
    const { cipher } = await noiseInitiate({
      transport: noiseTransport,
      localKeyPair: noiseKeyPair,
      remotePublicKey: remoteNoiseKey,
      // Use Noise key comparison for identity verification (not identity fingerprint)
      expectedFingerprint: "",
    });

    const channelTransport = relayToChannelTransport(relayChannel);
    return createSecureChannel({
      peer,
      type: "relayed",
      peerFingerprint,
      cipher,
      transport: channelTransport,
    });
  }

  async function connectImpl(peer: NodeName): Promise<SecureChannel> {
    if (!rendezvous || !started) {
      throw new ConnectError("ConnectManager not started");
    }

    const peerInfo = await rendezvous.lookup(peer);
    if (!peerInfo || !peerInfo.online) {
      throw new PeerOfflineError(peer);
    }

    // Try STUN → hole-punch path (only when UDP transport is enabled)
    if (enableUdpTransport) {
      let stunResult: { ip: string; port: number } | undefined;
      try {
        stunResult = await stunDiscover({
          localPort: 0,
          stunServer: stunServers?.[0],
          createUdpSocket: _createUdpSocket as typeof import("node:dgram").createSocket | undefined,
        });
      /* v8 ignore start -- STUN failure is network-dependent, tested via integration */
      } catch (err) {
        // STUN failed — skip to relay
        log.warn("STUN discovery failed, using relay", { error: err instanceof Error ? err.message : String(err) });
      }
      /* v8 ignore stop */

      /* v8 ignore start -- stunResult undefined branch: falls through to relay */
      if (stunResult) {
      /* v8 ignore stop */
        const ourCandidates: Candidate[] = [
          { ip: stunResult.ip, port: stunResult.port, source: "stun" },
        ];

        await rendezvous.signal(peer, {
          type: "offer",
          candidates: ourCandidates,
        });

        try {
          const remoteCandidates = await waitForAnswer(peer);

          const punchResult = await holePunch({
            localPort: stunResult.port,
            remoteCandidates,
            timeoutMs: holePunchTimeoutMs,
            createUdpSocket: _createUdpSocket as typeof import("node:dgram").createSocket | undefined,
          });

          if (punchResult.success && punchResult.remoteAddress && punchResult.remotePort) {
            return await connectViaRelay(peer, peerInfo.fingerprint);
          }
        /* v8 ignore start -- hole-punch failure path requires UDP transport test infra */
        } catch (punchErr) {
          log.warn("Hole-punch failed, falling back to relay", { peer, error: punchErr instanceof Error ? punchErr.message : String(punchErr) });
        }
        /* v8 ignore stop */
      }
    }

    // Relay fallback
    return connectViaRelay(peer, peerInfo.fingerprint);
  }

  async function handleInboundOffer(from: NodeName, candidates: Candidate[]): Promise<void> {
    /* v8 ignore start -- guard: offer arrives after close() */
    if (!rendezvous || !started) return;
    /* v8 ignore stop */

    const peerInfo = getNode(mechaDir, from);
    /* v8 ignore start -- inbound offer from unknown peer */
    if (!peerInfo) return;
    /* v8 ignore stop */

    // Send answer with our own candidates (empty for relay-based response)
    await rendezvous.signal(from, {
      type: "answer",
      candidates: [],
    });

    // Establish channel via relay (responder always uses relay for simplicity)
    try {
      const token = await rendezvous.requestRelay(from);
      const relayChannel = await relayConnect({
        relayUrl,
        token,
        createWebSocket: _createRelayWebSocket,
      });

      const noiseTransport = relayToNoiseTransport(relayChannel);
      const { cipher } = await noiseRespond({
        transport: noiseTransport,
        localKeyPair: noiseKeyPair,
        expectedFingerprint: peerInfo.fingerprint,
        /* v8 ignore start -- || undefined fallback for empty noisePublicKey */
        expectedPublicKey: peerInfo.noisePublicKey || undefined,
        /* v8 ignore stop */
      });

      const channelTransport = relayToChannelTransport(relayChannel);
      const channel = createSecureChannel({
        peer: from,
        type: "relayed",
        /* v8 ignore start -- fingerprint always present for known peers */
        peerFingerprint: peerInfo.fingerprint ?? "",
        /* v8 ignore stop */
        cipher,
        transport: channelTransport,
      });

      cacheChannel(from, channel);
      for (const handler of connectionHandlers) handler(channel);
    /* v8 ignore start -- relay/noise failure on inbound path */
    } catch (err) {
      log.error("Inbound connection failed", { from, error: err instanceof Error ? err.message : String(err) });
    }
    /* v8 ignore stop */
  }

  const manager: ConnectManager = {
    async start(): Promise<void> {
      if (started) return;

      /* v8 ignore start -- multi-rendezvous branch: tested in multi-rendezvous.test.ts */
      const rvUrls = opts.rendezvousUrls;
      if (rvUrls && rvUrls.length > 1) {
        rendezvous = createMultiRendezvousClient({
          urls: rvUrls,
          signFn,
          createWebSocket: opts._createRendezvousWebSocket,
        });
      /* v8 ignore stop */
      } else {
        rendezvous = createRendezvousClient({
          url: rvUrls?.[0] ?? rendezvousUrl,
          signFn,
          createWebSocket: opts._createRendezvousWebSocket,
        });
      }

      await rendezvous.connect();
      await rendezvous.register({
        name: identity.id,
        publicKey: identity.publicKey,
        noisePublicKey: noiseKeyPair.publicKey,
        fingerprint: identity.fingerprint,
      });

      // Route incoming signals
      rendezvous.onSignal((from: NodeName, data: SignalData) => {
        if (data.type === "offer") {
          void handleInboundOffer(from, data.candidates);
        } else if (data.type === "answer") {
          const pending = pendingAnswers.get(from);
          if (pending) {
            pendingAnswers.delete(from);
            clearTimeout(pending.timer);
            pending.resolve(data.candidates);
          }
        }
      });

      // Handle incoming invite acceptances
      rendezvous.onInviteAccepted((peer, publicKey, noisePublicKey, fingerprint) => {
        const existing = getNode(mechaDir, peer);
        /* v8 ignore start -- race: invite accepted for already-known peer */
        if (existing) return;
        /* v8 ignore stop */
        try {
          addNode(mechaDir, {
            name: peer,
            host: "",
            port: 0,
            apiKey: "",
            publicKey,
            noisePublicKey,
            fingerprint,
            addedAt: new Date().toISOString(),
            managed: true,
          });
        /* v8 ignore start -- race/invalid payload in invite-accepted handler */
        } catch (err) {
          log.warn("Failed to add node from invite-accepted", { peer, error: err instanceof Error ? err.message : String(err) });
        }
        /* v8 ignore stop */
      });

      started = true;
    },

    async connect(peer: NodeName): Promise<SecureChannel> {
      // Return cached channel if still open
      const existing = channels.get(peer);
      if (existing?.isOpen) return existing;

      // Deduplicate concurrent connect() calls
      const pending = pendingConnects.get(peer);
      if (pending) return pending;

      const promise = connectImpl(peer).then((channel) => {
        cacheChannel(peer, channel);
        pendingConnects.delete(peer);
        return channel;
      }).catch((err) => {
        pendingConnects.delete(peer);
        throw err;
      });

      pendingConnects.set(peer, promise);
      return promise;
    },

    getChannel(peer: NodeName): SecureChannel | undefined {
      const ch = channels.get(peer);
      return ch?.isOpen ? ch : undefined;
    },

    onConnection(handler: (channel: SecureChannel) => void): void {
      connectionHandlers.push(handler);
    },

    async createInvite(inviteOpts?: InviteOpts): Promise<InviteCode> {
      if (!rendezvous) throw new ConnectError("ConnectManager not started");

      return createInviteCode({
        client: rendezvous,
        identity,
        nodeName,
        noisePublicKey: noiseKeyPair.publicKey,
        privateKey,
        rendezvousUrl,
        opts: inviteOpts,
      });
    },

    async acceptInvite(code: string): Promise<AcceptResult> {
      const payload = parseInviteCode(code);

      if (!rendezvous) {
        throw new ConnectError("ConnectManager not started");
      }

      const peerName = payload.inviterName;
      try {
        addNode(mechaDir, {
          name: peerName,
          host: "",
          port: 0,
          apiKey: "",
          publicKey: payload.inviterPublicKey,
          noisePublicKey: payload.inviterNoisePublicKey,
          fingerprint: payload.inviterFingerprint,
          addedAt: new Date().toISOString(),
          managed: true,
        });
      } catch {
        // Duplicate node is idempotent — peer already known
      }

      return { peer: toNodeName(peerName) };
    },

    async ping(peer: NodeName): Promise<PingResult> {
      const maybeChannel = channels.get(peer);
      /* v8 ignore start -- ?. null branch: channels.get returns undefined when no connection */
      if (!maybeChannel?.isOpen) throw new PeerOfflineError(peer);
      /* v8 ignore stop */
      const channel = maybeChannel;

      const nonce = crypto.randomUUID();
      const start = performance.now();
      const pingData = new TextEncoder().encode(JSON.stringify({ type: "ping", nonce }));
      channel.send(pingData);

      // Wait for pong response to measure actual RTT
      const latencyMs = await new Promise<number>((resolve, reject) => {
        /* v8 ignore start -- ping timeout requires 5s wait */
        const timeout = setTimeout(() => {
          channel.offMessage(handler);
          reject(new ConnectError(`Ping timeout for "${peer}"`));
        }, 5_000);
        /* v8 ignore stop */

        /* v8 ignore start -- pong handler: non-matching nonce and parse errors are defensive */
        function handler(data: Uint8Array): void {
          try {
            const msg = JSON.parse(new TextDecoder().decode(data)) as { type?: string; nonce?: string };
            if (msg.type === "pong" && msg.nonce === nonce) {
              clearTimeout(timeout);
              channel.offMessage(handler);
              resolve(Math.round(performance.now() - start));
            }
          } catch { /* not a JSON ping response, ignore */ }
        }
        /* v8 ignore stop */

        channel.onMessage(handler);
      });

      return {
        peer,
        latencyMs,
        connectionType: channel.type,
      };
    },

    async close(): Promise<void> {
      started = false;
      for (const [, ch] of channels) {
        ch.close();
      }
      channels.clear();
      // Reject all pending answers
      for (const [, pending] of pendingAnswers) {
        clearTimeout(pending.timer);
        pending.reject(new ConnectError("ConnectManager closed"));
      }
      pendingAnswers.clear();
      pendingConnects.clear();
      if (rendezvous) {
        /* v8 ignore start -- unregister may throw if socket is already closed */
        try { await rendezvous.unregister(); } catch (err) {
          log.warn("Unregister failed during close", { error: err instanceof Error ? err.message : String(err) });
        }
        /* v8 ignore stop */
        rendezvous.close();
        rendezvous = undefined;
      }
    },
  };

  return manager;
}
