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
 * On disconnect, automatically fails over to the next server in the list.
 * If all servers are exhausted, notifies disconnect handlers.
 */
export function createMultiRendezvousClient(opts: MultiRendezvousOpts): RendezvousClient {
  const { urls, signFn, createWebSocket } = opts;
  if (urls.length === 0) throw new ConnectError("No rendezvous URLs provided");

  let activeClient: RendezvousClient | undefined;
  let activeIndex = -1;
  let savedIdentity: { name: string; publicKey: string; noisePublicKey: string; fingerprint: string } | undefined;
  let closedByUser = false;
  let failingOver = false;

  const signalHandlers: Array<(from: NodeName, data: SignalData) => void> = [];
  const inviteAcceptedHandlers: Array<(peer: string, publicKey: string, noisePublicKey: string, fingerprint: string) => void> = [];
  const disconnectHandlers: Array<() => void> = [];

  function wireHandlers(client: RendezvousClient): void {
    for (const handler of signalHandlers) {
      client.onSignal(handler);
    }
    for (const handler of inviteAcceptedHandlers) {
      client.onInviteAccepted(handler);
    }
    // Wire disconnect handler for automatic failover
    client.onDisconnect(() => {
      if (closedByUser || failingOver) return;
      void handleFailover();
    });
  }

  /* v8 ignore start -- failover requires real server disconnect */
  async function handleFailover(): Promise<void> {
    failingOver = true;
    const failedUrl = urls[activeIndex];
    const nextIndex = activeIndex + 1;
    activeClient = undefined;
    log.debug(`Server ${failedUrl} disconnected, attempting failover from index ${nextIndex}`);

    try {
      await tryConnect(nextIndex);
      // Abort if closed during async connect (re-read after async boundary)
      const connectedClient = activeClient as RendezvousClient | undefined;
      if (closedByUser) {
        connectedClient?.close();
        activeClient = undefined;
        return;
      }
      // Re-register identity on new server if we had one
      if (savedIdentity) {
        await getActive().register(savedIdentity);
        log.debug(`Re-registered identity on ${urls[activeIndex]}`);
      }
    } catch {
      // All remaining servers exhausted — notify disconnect handlers
      log.debug("All rendezvous servers exhausted after failover");
      for (const handler of disconnectHandlers) handler();
    } finally {
      failingOver = false;
    }
  }
  /* v8 ignore stop */

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
      closedByUser = false;
      await tryConnect(0);
    },

    async register(identity): Promise<void> {
      savedIdentity = identity;
      await getActive().register(identity);
    },

    async unregister(): Promise<void> {
      savedIdentity = undefined;
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

    onDisconnect(handler: () => void): void {
      disconnectHandlers.push(handler);
    },

    close(): void {
      closedByUser = true;
      activeClient?.close();
      activeClient = undefined;
      activeIndex = -1;
    },
  };
}
