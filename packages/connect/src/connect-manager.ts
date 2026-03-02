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
import type { ConnectState } from "./connect-io.js";
import { waitForAnswer, cacheChannel, connectViaRelay, handleInboundOffer } from "./connect-io.js";

const log = createLogger("mecha:connect");
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

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
    answerTimeoutMs = 10_000,
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
  let startPromise: Promise<void> | undefined;

  /* v8 ignore start -- signFn is passed to rendezvous client, invoked by server protocol */
  const signFn = (data: Uint8Array): string => {
    return signMessage(privateKey, data);
  };
  /* v8 ignore stop */

  /** Build ConnectState from current closure for I/O helpers. */
  function state(): ConnectState {
    /* v8 ignore start -- guard: state() called before start() */
    if (!rendezvous) {
      throw new ConnectError("ConnectManager not started");
    }
    /* v8 ignore stop */
    return {
      rendezvous,
      channels,
      pendingConnects,
      pendingAnswers,
      connectionHandlers,
      noiseKeyPair,
      mechaDir,
      relayUrl,
      answerTimeoutMs,
      _createRelayWebSocket,
    };
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
          const remoteCandidates = await waitForAnswer(state(), peer);

          const punchResult = await holePunch({
            localPort: stunResult.port,
            remoteCandidates,
            timeoutMs: holePunchTimeoutMs,
            createUdpSocket: _createUdpSocket as typeof import("node:dgram").createSocket | undefined,
          });

          if (punchResult.success && punchResult.remoteAddress && punchResult.remotePort) {
            // TODO: Build direct UDP channel using punchResult instead of relay.
            // Currently falls through to relay even on successful punch because
            // direct UDP transport is not yet implemented. The enableUdpTransport
            // flag is false by default so this path is unreachable in production.
            return await connectViaRelay(state(), peer, peerInfo.fingerprint);
          }
        /* v8 ignore start -- hole-punch failure path requires UDP transport test infra */
        } catch (punchErr) {
          log.warn("Hole-punch failed, falling back to relay", { peer, error: punchErr instanceof Error ? punchErr.message : String(punchErr) });
        }
        /* v8 ignore stop */
      }
    }

    // Relay fallback
    return connectViaRelay(state(), peer, peerInfo.fingerprint);
  }

  async function startInner(): Promise<void> {
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
        /* v8 ignore start -- guard: offer arrives after close() */
        if (!rendezvous || !started) return;
        /* v8 ignore stop */
        void handleInboundOffer(state(), from, data.candidates);
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
  }

  const manager: ConnectManager = {
    async start(): Promise<void> {
      if (started) return;
      /* v8 ignore start -- dedup: concurrent start() calls */
      if (startPromise) return startPromise;
      /* v8 ignore stop */
      startPromise = startInner().finally(() => { startPromise = undefined; });
      return startPromise;
    },

    async connect(peer: NodeName): Promise<SecureChannel> {
      // Return cached channel if still open
      const existing = channels.get(peer);
      if (existing?.isOpen) return existing;

      // Deduplicate concurrent connect() calls
      const pending = pendingConnects.get(peer);
      if (pending) return pending;

      const promise = connectImpl(peer).then((channel) => {
        pendingConnects.delete(peer);
        // Guard: if close() was called during in-flight connect, discard the channel
        /* v8 ignore start -- race: close() during in-flight connect */
        if (!started) {
          channel.close();
          throw new ConnectError("ConnectManager closed during connect");
        }
        /* v8 ignore stop */
        cacheChannel({ channels, pendingConnects }, peer, channel);
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
      /* v8 ignore start -- guard: createInvite called before start() */
      if (!rendezvous) {
        throw new ConnectError("ConnectManager not started");
      }
      /* v8 ignore stop */

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
      /* v8 ignore start -- duplicate node is idempotent; non-duplicate errors rethrown */
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes("already exists")) throw err;
      }
      /* v8 ignore stop */

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
      const pingData = textEncoder.encode(JSON.stringify({ type: "ping", nonce }));
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
            const msg = JSON.parse(textDecoder.decode(data)) as { type?: string; nonce?: string };
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
