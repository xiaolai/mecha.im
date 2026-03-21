import type { NodeName, NodeIdentity } from "@mecha/core";

// --- Key types ---

/** X25519 key pair used for Noise protocol handshakes. */
export interface NoiseKeyPair {
  publicKey: string;    // base64url-encoded X25519 public key
  privateKey: string;   // base64url-encoded X25519 private key
}

// --- Connection types ---

/** Transport method used to establish a peer connection. */
export type ConnectionType = "lan" | "direct" | "hole-punched" | "relayed";

// --- SecureChannel ---

/** Encrypted bidirectional communication channel to a peer node. */
export interface SecureChannel {
  readonly peer: NodeName;
  readonly type: ConnectionType;
  readonly latencyMs: number;
  readonly peerFingerprint: string;
  send(data: Uint8Array): void;
  onMessage(handler: (data: Uint8Array) => void): void;
  offMessage(handler: (data: Uint8Array) => void): void;
  onClose(handler: (reason: string) => void): void;
  offClose(handler: (reason: string) => void): void;
  onError(handler: (err: Error) => void): void;
  offError(handler: (err: Error) => void): void;
  close(): void;
  readonly isOpen: boolean;
}

// --- Invite ---

/** Options for creating a peer invite. */
export interface InviteOpts {
  expiresIn?: number;    // seconds, default: 86400 (24h)
}

/** Generated invite code with token and expiry metadata. */
export interface InviteCode {
  code: string;          // "mecha://invite/<base64url-payload>"
  token: string;         // raw token for server registration
  expiresAt: string;     // ISO timestamp
}

/** Signed payload embedded in a mecha:// invite URL. */
export interface InvitePayload {
  inviterName: string;
  inviterPublicKey: string;
  inviterFingerprint: string;
  inviterNoisePublicKey: string;
  rendezvousUrl: string;
  /** Ordered list of rendezvous URLs (embedded → peer → central). Present in 6b+ invites. */
  rendezvousUrls?: string[];
  token: string;
  expiresAt: string;
  signature: string;
}

/** Result of accepting a peer invite. */
export interface AcceptResult {
  peer: NodeName;
  /** Undefined when P2P infrastructure is not yet deployed (Phase 6 MVP). */
  channel?: SecureChannel;
}

// --- Ping ---

/** Latency measurement result from pinging a peer. */
export interface PingResult {
  peer: NodeName;
  latencyMs: number;
  connectionType: ConnectionType;
}

// --- Rendezvous ---

/** Peer registration info returned by the rendezvous server. */
export interface PeerInfo {
  name: string;
  publicKey: string;
  noisePublicKey: string;
  fingerprint: string;
  online: boolean;
  sameLan?: boolean;
  privateCandidates?: string[];
}

/** Network address candidate for hole-punching or direct connection. */
export interface Candidate {
  ip: string;
  port: number;
  source: "stun" | "local" | "vpn";
}

/** Signaling message exchanged between peers via the rendezvous server. */
export type SignalData =
  | { type: "offer"; candidates: Candidate[] }
  | { type: "answer"; candidates: Candidate[] }
  | { type: "relay-ready"; token: string };

// --- STUN ---

/** Public IP and port discovered via STUN. */
export interface StunResult {
  ip: string;
  port: number;
}

// --- Hole-punch ---

/** Outcome of a UDP hole-punch attempt. */
export interface HolePunchResult {
  success: boolean;
  remoteAddress?: string;
  remotePort?: number;
  candidateIndex?: number;
}

// --- Noise ---

/** Symmetric cipher for encrypting/decrypting Noise protocol frames. */
export interface NoiseCipher {
  encrypt(plaintext: Uint8Array): Uint8Array;
  decrypt(ciphertext: Uint8Array): Uint8Array;
  rekey(): void;
}

/** Low-level send/receive transport used during Noise handshake. */
export interface NoiseTransport {
  send(data: Uint8Array): void;
  receive(): Promise<Uint8Array>;
}

/** Result of a completed Noise handshake containing the cipher and remote key. */
export interface NoiseHandshakeResult {
  cipher: NoiseCipher;
  remoteStaticKey: Uint8Array;
}

// --- Relay ---

/** Unencrypted relay-server transport channel between two peers. */
export interface RelayChannel {
  send(data: Uint8Array): void;
  onMessage(handler: (data: Uint8Array) => void): void;
  onClose(handler: (reason: string) => void): void;
  close(): void;
}

// --- Channel Fetch ---

/** HTTP-like request sent over a SecureChannel. */
export interface ChannelRequest {
  id: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: string;
}

/** HTTP-like response received over a SecureChannel. */
export interface ChannelResponse {
  id: string;
  status: number;
  headers: Record<string, string>;
  body?: string;
}

// --- Connect Manager ---

/** Configuration options for creating a ConnectManager. */
export interface ConnectOpts {
  identity: NodeIdentity;
  nodeName: string;
  privateKey: string;
  noiseKeyPair: NoiseKeyPair;
  mechaDir: string;
  rendezvousUrl?: string;
  /** Ordered list of rendezvous URLs (local → peer → central). Uses MultiRendezvousClient when >1. */
  rendezvousUrls?: string[];
  stunServers?: string[];
  relayUrl?: string;
  holePunchTimeoutMs?: number;
  /** Answer signal timeout (ms). Default: 10_000 */
  answerTimeoutMs?: number;
  /** Enable UDP transport (STUN/hole-punch). Default: false — goes straight to relay. */
  enableUdpTransport?: boolean;
  /** DI: WebSocket factory for rendezvous client */
  _createRendezvousWebSocket?: (url: string) => import("./relay.js").WebSocketLike;
  /** DI: WebSocket factory for relay connections */
  _createRelayWebSocket?: (url: string) => import("./relay.js").WebSocketLike;
  /** DI: dgram.createSocket factory for UDP */
  _createUdpSocket?: (type: "udp4") => import("node:dgram").Socket;
}

/** Orchestrates P2P connectivity: discovery, connection, invite, and ping. */
export interface ConnectManager {
  start(): Promise<void>;
  connect(peer: NodeName): Promise<SecureChannel>;
  getChannel(peer: NodeName): SecureChannel | undefined;
  onConnection(handler: (channel: SecureChannel) => void): void;
  createInvite(opts?: InviteOpts): Promise<InviteCode>;
  acceptInvite(code: string): Promise<AcceptResult>;
  ping(peer: NodeName): Promise<PingResult>;
  close(): Promise<void>;
}

/** Event handlers emitted by the ConnectManager. */
export interface ConnectManagerEvents {
  connection: (channel: SecureChannel) => void;
  "channel-closed": (peer: NodeName, reason: string) => void;
  offline: () => void;
  online: () => void;
  "auth-failed": (peer: NodeName, reason: string) => void;
}

// --- Rendezvous Client ---

/** WebSocket-based client for peer discovery and signaling via a rendezvous server. */
export interface RendezvousClient {
  connect(): Promise<void>;
  register(identity: { name: string; publicKey: string; noisePublicKey: string; fingerprint: string }): Promise<void>;
  unregister(): Promise<void>;
  lookup(peer: NodeName): Promise<PeerInfo | undefined>;
  signal(peer: NodeName, data: SignalData): Promise<void>;
  requestRelay(peer: NodeName): Promise<string>;
  onSignal(handler: (from: NodeName, data: SignalData) => void): void;
  onInviteAccepted(handler: (peer: string, publicKey: string, noisePublicKey: string, fingerprint: string) => void): void;
  /** Register a handler called when the connection is lost and cannot be recovered. */
  onDisconnect(handler: () => void): void;
  close(): void;
}
