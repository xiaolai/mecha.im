// @mecha/connect — P2P connectivity library

export { createConnectManager } from "./connect-manager.js";
export { createSecureChannel } from "./channel.js";
export type { ChannelTransport, CreateChannelOpts } from "./channel.js";
export { channelFetch } from "./channel-fetch.js";
export type { ChannelFetchOpts } from "./channel-fetch.js";
export { createNoiseCipher, noiseInitiate, noiseRespond } from "./noise.js";
export type { NoiseInitiateOpts, NoiseRespondOpts } from "./noise.js";
export { stunDiscover, buildBindingRequest, parseBindingResponse, parseStunServer } from "./stun.js";
export type { StunDiscoverOpts } from "./stun.js";
export { holePunch } from "./hole-punch.js";
export type { HolePunchOpts } from "./hole-punch.js";
export { relayConnect } from "./relay.js";
export type { RelayConnectOpts, WebSocketLike } from "./relay.js";
export { createRendezvousClient } from "./rendezvous.js";
export type { CreateRendezvousClientOpts } from "./rendezvous.js";
export { createMultiRendezvousClient } from "./multi-rendezvous.js";
export type { MultiRendezvousOpts } from "./multi-rendezvous.js";
export { createInviteCode, parseInviteCode } from "./invite.js";
export type { CreateInviteOpts } from "./invite.js";
export {
  relayToNoiseTransport,
  relayToChannelTransport,
  udpToNoiseTransport,
  udpToChannelTransport,
} from "./transport-adapters.js";

export type {
  NoiseKeyPair,
  ConnectionType,
  SecureChannel,
  InviteOpts,
  InviteCode,
  InvitePayload,
  AcceptResult,
  PingResult,
  PeerInfo,
  Candidate,
  SignalData,
  StunResult,
  HolePunchResult,
  NoiseCipher,
  NoiseTransport,
  NoiseHandshakeResult,
  RelayChannel,
  ChannelRequest,
  ChannelResponse,
  ConnectOpts,
  ConnectManager,
  ConnectManagerEvents,
  RendezvousClient,
} from "./types.js";
