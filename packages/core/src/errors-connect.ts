import { defError } from "./errors-base.js";

// --- Connectivity errors (Phase 6) ---
/** Error thrown when a mesh connection attempt fails. */
export const ConnectError = defError<[string]>(
  "ConnectError",
  { code: "CONNECT_ERROR", statusCode: 503, exitCode: 1 },
  (reason) => `Connection failed: ${reason}`,
);

/** Error thrown when a mesh invite code is invalid. */
export const InvalidInviteError = defError<[string]>(
  "InvalidInviteError",
  { code: "INVALID_INVITE", statusCode: 400, exitCode: 1 },
  (reason) => `Invalid invite: ${reason}`,
);

/** Error thrown when a mesh handshake fails. */
export const HandshakeError = defError<[string]>(
  "HandshakeError",
  { code: "HANDSHAKE_ERROR", statusCode: 502, exitCode: 1 },
  (reason) => `Handshake failed: ${reason}`,
);

/** Error thrown when a mesh peer is offline. */
export const PeerOfflineError = defError<[string]>(
  "PeerOfflineError",
  { code: "PEER_OFFLINE", statusCode: 503, exitCode: 1 },
  (name) => `Peer "${name}" is offline`,
);

/** Error thrown when rendezvous signaling fails. */
export const RendezvousError = defError<[string]>(
  "RendezvousError",
  { code: "RENDEZVOUS_ERROR", statusCode: 502, exitCode: 1 },
  (reason) => `Rendezvous server error: ${reason}`,
);
