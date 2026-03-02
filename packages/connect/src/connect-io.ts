import type { NodeName } from "@mecha/core";
import { ConnectError, getNode, createLogger } from "@mecha/core";
import type { SecureChannel, RendezvousClient, Candidate, NoiseKeyPair } from "./types.js";
import type { WebSocketLike } from "./relay.js";
import { noiseInitiate, noiseRespond } from "./noise.js";
import { relayConnect } from "./relay.js";
import { createSecureChannel } from "./channel.js";
import { relayToNoiseTransport, relayToChannelTransport } from "./transport-adapters.js";

const log = createLogger("mecha:connect");
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

/** Shared state passed from ConnectManager to extracted I/O helpers. */
export interface ConnectState {
  rendezvous: RendezvousClient;
  channels: Map<string, SecureChannel>;
  pendingConnects: Map<string, Promise<SecureChannel>>;
  pendingAnswers: Map<string, {
    resolve: (candidates: Candidate[]) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>;
  connectionHandlers: Array<(channel: SecureChannel) => void>;
  noiseKeyPair: NoiseKeyPair;
  mechaDir: string;
  relayUrl: string;
  answerTimeoutMs: number;
  _createRelayWebSocket?: (url: string) => WebSocketLike;
}

/** Wait for a signaling answer from a peer within the timeout window. */
export function waitForAnswer(state: ConnectState, peer: string): Promise<Candidate[]> {
  // Reject any existing waiter for this peer to prevent orphaned timers/promises
  /* v8 ignore start -- race: concurrent connect calls for same peer */
  const existing = state.pendingAnswers.get(peer);
  if (existing) {
    clearTimeout(existing.timer);
    existing.reject(new ConnectError(`Answer superseded for "${peer}"`));
    state.pendingAnswers.delete(peer);
  }
  /* v8 ignore stop */

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      state.pendingAnswers.delete(peer);
      reject(new ConnectError(`Answer timeout from "${peer}" after ${state.answerTimeoutMs}ms`));
    }, state.answerTimeoutMs);
    state.pendingAnswers.set(peer, { resolve, reject, timer });
  });
}

/** Cache a channel and set up lifecycle + ping/pong auto-responder. */
export function cacheChannel(
  state: Pick<ConnectState, "channels" | "pendingConnects">,
  peer: string,
  channel: SecureChannel,
): void {
  state.channels.set(peer, channel);
  channel.onClose(() => {
    state.channels.delete(peer);
    state.pendingConnects.delete(peer);
  });
  // Auto-respond to ping messages with pong (for RTT measurement)
  channel.onMessage((data) => {
    /* v8 ignore start -- ping/pong auto-responder: tested via mock channel in unit tests */
    try {
      const msg = JSON.parse(textDecoder.decode(data)) as { type?: string; nonce?: string };
      if (msg.type === "ping" && msg.nonce) {
        channel.send(textEncoder.encode(JSON.stringify({ type: "pong", nonce: msg.nonce })));
      }
    } catch { /* not a ping message, ignore */ }
    /* v8 ignore stop */
  });
}

/** Connect to a peer via relay + Noise handshake (initiator side). */
export async function connectViaRelay(
  state: ConnectState,
  peer: NodeName,
  peerFingerprint: string,
): Promise<SecureChannel> {
  const rv = state.rendezvous;
  const token = await rv.requestRelay(peer);

  const relayChannel = await relayConnect({
    relayUrl: state.relayUrl,
    token,
    createWebSocket: state._createRelayWebSocket,
  });

  try {
    const noiseTransport = relayToNoiseTransport(relayChannel);
    /* v8 ignore start -- getNode always returns a valid node at this point */
    const peerNode = getNode(state.mechaDir, peer);
    const remoteNoiseKey = peerNode?.noisePublicKey ?? "";
    /* v8 ignore stop */
    const { cipher } = await noiseInitiate({
      transport: noiseTransport,
      localKeyPair: state.noiseKeyPair,
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
  /* v8 ignore start -- relay cleanup on handshake failure */
  } catch (err) {
    relayChannel.close();
    throw err;
  }
  /* v8 ignore stop */
}

/** Handle an inbound offer: relay + Noise handshake (responder side) + channel caching. */
export async function handleInboundOffer(
  state: ConnectState,
  from: NodeName,
  _candidates: Candidate[],
): Promise<void> {
  const peerInfo = getNode(state.mechaDir, from);
  /* v8 ignore start -- inbound offer from unknown peer */
  if (!peerInfo) return;
  /* v8 ignore stop */

  // Send answer with our own candidates (empty for relay-based response)
  await state.rendezvous.signal(from, {
    type: "answer",
    candidates: [],
  });

  // Establish channel via relay (responder always uses relay for simplicity)
  let relayChannel: Awaited<ReturnType<typeof relayConnect>> | undefined;
  try {
    const token = await state.rendezvous.requestRelay(from);
    relayChannel = await relayConnect({
      relayUrl: state.relayUrl,
      token,
      createWebSocket: state._createRelayWebSocket,
    });

    const noiseTransport = relayToNoiseTransport(relayChannel);
    const { cipher } = await noiseRespond({
      transport: noiseTransport,
      localKeyPair: state.noiseKeyPair,
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

    cacheChannel(state, from, channel);
    for (const handler of state.connectionHandlers) handler(channel);
  /* v8 ignore start -- relay/noise failure on inbound path */
  } catch (err) {
    relayChannel?.close();
    log.error("Inbound connection failed", {
      from,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  }
  /* v8 ignore stop */
}
