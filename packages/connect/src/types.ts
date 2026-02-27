import type { NodeName, NodeIdentity } from "@mecha/core";

// --- Key types ---

export interface NoiseKeyPair {
  publicKey: string;    // base64url-encoded X25519 public key
  privateKey: string;   // base64url-encoded X25519 private key
}

// --- Connection types ---

export type ConnectionType = "lan" | "direct" | "hole-punched" | "relayed";

// --- SecureChannel ---

export interface SecureChannel {
  readonly peer: NodeName;
  readonly type: ConnectionType;
  readonly latencyMs: number;
  readonly peerFingerprint: string;
  send(data: Uint8Array): void;
  onMessage(handler: (data: Uint8Array) => void): void;
  offMessage(handler: (data: Uint8Array) => void): void;
  onClose(handler: (reason: string) => void): void;
  onError(handler: (err: Error) => void): void;
  offError(handler: (err: Error) => void): void;
  close(): void;
  readonly isOpen: boolean;
}

// --- Invite ---

export interface InviteOpts {
  expiresIn?: number;    // seconds, default: 86400 (24h)
}

export interface InviteCode {
  code: string;          // "mecha://invite/<base64url-payload>"
  token: string;         // raw token for server registration
  expiresAt: string;     // ISO timestamp
}

export interface InvitePayload {
  inviterName: string;
  inviterPublicKey: string;
  inviterFingerprint: string;
  inviterNoisePublicKey: string;
  rendezvousUrl: string;
  token: string;
  expiresAt: string;
  signature: string;
}

export interface AcceptResult {
  peer: NodeName;
  /** Undefined when P2P infrastructure is not yet deployed (Phase 6 MVP). */
  channel?: SecureChannel;
}

// --- Ping ---

export interface PingResult {
  peer: NodeName;
  latencyMs: number;
  connectionType: ConnectionType;
}

// --- Rendezvous ---

export interface PeerInfo {
  name: string;
  publicKey: string;
  noisePublicKey: string;
  fingerprint: string;
  online: boolean;
  sameLan: boolean;
  privateCandidates?: string[];
}

export interface Candidate {
  ip: string;
  port: number;
  source: "stun" | "local" | "vpn";
}

export type SignalData =
  | { type: "offer"; candidates: Candidate[] }
  | { type: "answer"; candidates: Candidate[] }
  | { type: "relay-ready"; token: string };

// --- STUN ---

export interface StunResult {
  ip: string;
  port: number;
}

// --- Hole-punch ---

export interface HolePunchResult {
  success: boolean;
  remoteAddress?: string;
  remotePort?: number;
  candidateIndex?: number;
}

// --- Noise ---

export interface NoiseCipher {
  encrypt(plaintext: Uint8Array): Uint8Array;
  decrypt(ciphertext: Uint8Array): Uint8Array;
  rekey(): void;
}

export interface NoiseTransport {
  send(data: Uint8Array): void;
  receive(): Promise<Uint8Array>;
}

export interface NoiseHandshakeResult {
  cipher: NoiseCipher;
  remoteStaticKey: Uint8Array;
}

// --- Relay ---

export interface RelayChannel {
  send(data: Uint8Array): void;
  onMessage(handler: (data: Uint8Array) => void): void;
  onClose(handler: (reason: string) => void): void;
  close(): void;
}

// --- Channel Fetch ---

export interface ChannelRequest {
  id: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: string;
}

export interface ChannelResponse {
  id: string;
  status: number;
  headers: Record<string, string>;
  body?: string;
}

// --- Connect Manager ---

export interface ConnectOpts {
  identity: NodeIdentity;
  nodeName: string;
  privateKey: string;
  noiseKeyPair: NoiseKeyPair;
  mechaDir: string;
  rendezvousUrl?: string;
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

export interface ConnectManagerEvents {
  connection: (channel: SecureChannel) => void;
  "channel-closed": (peer: NodeName, reason: string) => void;
  offline: () => void;
  online: () => void;
  "auth-failed": (peer: NodeName, reason: string) => void;
}

// --- Rendezvous Client ---

export interface RendezvousClient {
  connect(): Promise<void>;
  register(identity: { name: string; publicKey: string; noisePublicKey: string; fingerprint: string }): Promise<void>;
  unregister(): Promise<void>;
  lookup(peer: NodeName): Promise<PeerInfo | undefined>;
  signal(peer: NodeName, data: SignalData): Promise<void>;
  requestRelay(peer: NodeName): Promise<string>;
  onSignal(handler: (from: NodeName, data: SignalData) => void): void;
  onInviteAccepted(handler: (peer: string, publicKey: string, noisePublicKey: string, fingerprint: string) => void): void;
  close(): void;
}
