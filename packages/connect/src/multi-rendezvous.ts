import { ConnectError, createLogger } from "@mecha/core";
import type { NodeName } from "@mecha/core";
import type { RendezvousClient, PeerInfo, SignalData } from "./types.js";
import { createRendezvousClient } from "./rendezvous.js";
import type { WebSocketLike } from "./relay.js";

const log = createLogger("mecha:multi-rendezvous");

export interface MultiRendezvousOpts {
  urls: string[];
  signFn: (data: Uint8Array) => string;
  createWebSocket?: (url: string) => WebSocketLike;
}

/**
 * Create a RendezvousClient that tries multiple servers in order.
 * First successful connection becomes the active client.
 *
 * NOTE: Disconnect failover is not yet implemented. Currently, once connected
 * to a server, disconnection will not trigger automatic failover to the next URL.
 * This will be addressed in a future phase when reconnect orchestration is added.
 */
export function createMultiRendezvousClient(opts: MultiRendezvousOpts): RendezvousClient {
  const { urls, signFn, createWebSocket } = opts;
  if (urls.length === 0) throw new ConnectError("No rendezvous URLs provided");

  let activeClient: RendezvousClient | undefined;
  let activeIndex = -1;
  let savedIdentity: { name: string; publicKey: string; noisePublicKey: string; fingerprint: string } | undefined;

  const signalHandlers: Array<(from: NodeName, data: SignalData) => void> = [];
  const inviteAcceptedHandlers: Array<(peer: string, publicKey: string, noisePublicKey: string, fingerprint: string) => void> = [];

  function wireHandlers(client: RendezvousClient): void {
    for (const handler of signalHandlers) {
      client.onSignal(handler);
    }
    for (const handler of inviteAcceptedHandlers) {
      client.onInviteAccepted(handler);
    }
  }

  async function tryConnect(startIndex: number): Promise<void> {
    for (let i = startIndex; i < urls.length; i++) {
      try {
        const client = createRendezvousClient({
          url: urls[i],
          signFn,
          createWebSocket,
          reconnectMaxAttempts: 0, // We handle failover ourselves
        });
        await client.connect();
        activeClient = client;
        activeIndex = i;
        wireHandlers(client);
        log.debug(`Connected to rendezvous server ${urls[i]}`);
        return;
      /* v8 ignore start -- connection failures during failover */
      } catch (err) {
        log.debug(`Failed to connect to ${urls[i]}: ${err instanceof Error ? err.message : String(err)}`);
      }
      /* v8 ignore stop */
    }
    throw new ConnectError("All rendezvous servers unreachable");
  }

  function getActive(): RendezvousClient {
    if (!activeClient) throw new ConnectError("Not connected to any rendezvous server");
    return activeClient;
  }

  return {
    async connect(): Promise<void> {
      await tryConnect(0);
    },

    async register(identity): Promise<void> {
      savedIdentity = identity;
      await getActive().register(identity);
    },

    async unregister(): Promise<void> {
      await getActive().unregister();
    },

    async lookup(peer: NodeName): Promise<PeerInfo | undefined> {
      return getActive().lookup(peer);
    },

    async signal(peer: NodeName, data: SignalData): Promise<void> {
      await getActive().signal(peer, data);
    },

    async requestRelay(peer: NodeName): Promise<string> {
      return getActive().requestRelay(peer);
    },

    onSignal(handler: (from: NodeName, data: SignalData) => void): void {
      signalHandlers.push(handler);
      if (activeClient) {
        activeClient.onSignal(handler);
      }
    },

    onInviteAccepted(handler: (peer: string, publicKey: string, noisePublicKey: string, fingerprint: string) => void): void {
      inviteAcceptedHandlers.push(handler);
      /* v8 ignore start -- activeClient always undefined when handlers are registered before connect */
      if (activeClient) {
        activeClient.onInviteAccepted(handler);
      }
      /* v8 ignore stop */
    },

    close(): void {
      activeClient?.close();
      activeClient = undefined;
      activeIndex = -1;
    },
  };
}
