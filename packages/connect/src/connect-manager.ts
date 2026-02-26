import { DEFAULTS, addNode, getNode, ConnectError, PeerOfflineError, signMessage } from "@mecha/core";
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
} from "./types.js";
import { createRendezvousClient } from "./rendezvous.js";
import { createInviteCode, parseInviteCode } from "./invite.js";

/* v8 ignore start -- requires rendezvous/relay infrastructure */

/**
 * Create a ConnectManager that orchestrates P2P connectivity.
 *
 * Manages rendezvous registration, invite system, and lazy connections.
 * STUN, hole-punch, and Noise handshake are deferred to actual connect() calls.
 */
export function createConnectManager(opts: ConnectOpts): ConnectManager {
  const {
    identity,
    nodeName,
    privateKey,
    noiseKeyPair,
    mechaDir,
    rendezvousUrl = DEFAULTS.RENDEZVOUS_URL,
  } = opts;

  const channels = new Map<string, SecureChannel>();
  let rendezvous: RendezvousClient | undefined;
  let started = false;

  const signFn = (data: Uint8Array): string => {
    return signMessage(privateKey, data);
  };

  const manager: ConnectManager = {
    async start(): Promise<void> {
      if (started) return;

      rendezvous = createRendezvousClient({
        url: rendezvousUrl,
        signFn,
      });

      await rendezvous.connect();
      await rendezvous.register({
        name: identity.id,
        publicKey: identity.publicKey,
        noisePublicKey: noiseKeyPair.publicKey,
        fingerprint: identity.fingerprint,
      });

      // Handle incoming invite acceptances
      rendezvous.onInviteAccepted((peer, publicKey, noisePublicKey, fingerprint) => {
        // Add peer to registry if not already present
        const existing = getNode(mechaDir, peer);
        /* v8 ignore start -- race: invite accepted for already-known peer */
        if (existing) return;
        /* v8 ignore stop */
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
      });

      started = true;
    },

    async connect(peer: NodeName): Promise<SecureChannel> {
      // Return cached channel if still open
      const existing = channels.get(peer);
      if (existing?.isOpen) return existing;

      // For Phase 6 MVP: the actual P2P connection (STUN → hole-punch → relay)
      // requires infrastructure (rendezvous + relay servers) to be deployed.
      // This throws a clear error until infrastructure is ready.
      throw new ConnectError(
        `P2P connection to "${peer}" not yet available — rendezvous infrastructure required`,
      );
    },

    getChannel(peer: NodeName): SecureChannel | undefined {
      const ch = channels.get(peer);
      return ch?.isOpen ? ch : undefined;
    },

    onConnection(): void {
      // Reserved for future P2P connection event handling
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

      // Ensure we have a rendezvous client for the invite's URL
      if (!rendezvous) {
        throw new ConnectError("ConnectManager not started");
      }

      // Add peer to node registry
      const peerName = payload.inviterName;
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

      // Phase 6 MVP: peer added to registry but P2P channel not yet available
      return { peer: peerName as NodeName };
    },

    async ping(peer: NodeName): Promise<PingResult> {
      const ch = channels.get(peer);
      if (!ch?.isOpen) throw new PeerOfflineError(peer);

      const start = performance.now();
      const pingData = new TextEncoder().encode("ping");
      ch.send(pingData);

      // For full implementation: wait for pong response
      // For now: return the cached latency
      const latencyMs = Math.round(performance.now() - start);

      return {
        peer,
        latencyMs: ch.latencyMs || latencyMs,
        connectionType: ch.type,
      };
    },

    async close(): Promise<void> {
      started = false;
      for (const [, ch] of channels) {
        ch.close();
      }
      channels.clear();
      if (rendezvous) {
        await rendezvous.unregister();
        rendezvous.close();
        rendezvous = undefined;
      }
    },
  };

  return manager;
}
/* v8 ignore stop */
