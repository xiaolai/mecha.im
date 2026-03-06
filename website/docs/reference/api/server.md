---
title: "@mecha/server"
description: API reference for @mecha/server — rendezvous server, WebSocket signaling, relay tunneling, gossip protocol, and invite-based onboarding.
---

# @mecha/server

The `@mecha/server` package provides the rendezvous server for P2P peer discovery, WebSocket signaling, relay tunneling, gossip protocol, and invite-based onboarding.

## Barrel Exports

| Export | Kind | Source |
|--------|------|--------|
| `createServer` | Function | `index.ts` |
| `nodes` | Map | `signaling.ts` -- in-memory online node registry |
| `invites` | Map | `invites.ts` -- in-memory pending invite store |
| `relayPairs` | Map | `relay.ts` -- active relay pair store |
| `DEFAULT_CONFIG` | Object | `types.ts` -- default server configuration |
| `ServerConfig` | Type | `types.ts` |
| `OnlineNode` | Type | `types.ts` |
| `PendingInvite` | Type | `types.ts` |
| `RelayPair` | Type | `types.ts` |
| `RelayTokenPayload` | Type | `relay-tokens.ts` |
| `createRelayToken` | Function | `relay-tokens.ts` |
| `validateRelayToken` | Function | `relay-tokens.ts` |
| `createGossipCache` | Function | `gossip-cache.ts` |
| `PeerRecord` | Type | `gossip-cache.ts` |
| `GossipCache` | Type | `gossip-cache.ts` |
| `VectorClock` | Type | `vector-clock.ts` |
| `increment` | Function | `vector-clock.ts` |
| `merge` | Function | `vector-clock.ts` |
| `isNewer` | Function | `vector-clock.ts` |
| `diff` | Function | `vector-clock.ts` |
| `GossipMessage` | Type | `gossip.ts` |

## `createServer(overrides?)`

Creates a fully configured Fastify server with WebSocket support, signaling, invites, relay, and optionally gossip.

```ts
import { createServer } from "@mecha/server";

const app = await createServer({
  port: 7680,
  host: "0.0.0.0",
  mechaDir: "/Users/you/.mecha", // enables gossip
});

await app.listen({ port: 7680, host: "0.0.0.0" });
```

**HTTP Routes:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/healthz` | Health check (`{ status: "ok" }`) |
| `GET` | `/lookup/:name` | REST lookup for a node by name (also checks gossip cache) |

## Types

### `ServerConfig`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `port` | `number` | `7680` | Server port |
| `host` | `string` | `"0.0.0.0"` | Bind address |
| `relayUrl` | `string` | `"wss://relay.mecha.im"` | Public relay WebSocket URL |
| `relayPairTimeoutMs` | `number` | `60000` | Timeout for relay pair matching |
| `relayMaxSessionMs` | `number` | `3600000` | Max relay session duration (1 hour) |
| `relayMaxMessageBytes` | `number` | `65536` | Max relay message size (64 KB) |
| `relayMaxPairs` | `number` | `1000` | Max concurrent relay pairs |
| `inviteMaxPending` | `number` | `10000` | Max pending invites |
| `trustProxy` | `boolean \| string` | `false` | Trust `X-Forwarded-For` headers |
| `secret` | `Buffer?` | (auto-generated) | HMAC secret for self-verifiable relay tokens |
| `mechaDir` | `string?` | — | Mecha config dir (enables gossip peer validation) |

### `OnlineNode`

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Node name |
| `publicKey` | `string` | Ed25519 public key (base64 DER or PEM) |
| `noisePublicKey` | `string` | X25519 Noise public key |
| `fingerprint` | `string` | Key fingerprint |
| `ws` | `WebSocket` | Active WebSocket connection |
| `publicIp` | `string` | Client IP from connection |
| `registeredAt` | `number` | Unix timestamp of registration |

### `PendingInvite`

| Field | Type | Description |
|-------|------|-------------|
| `token` | `string` | Unique invite token |
| `inviterName` | `string` | Name of the inviting node |
| `inviterPublicKey` | `string` | Inviter's Ed25519 public key |
| `inviterFingerprint` | `string` | Inviter's key fingerprint |
| `inviterNoisePublicKey` | `string` | Inviter's Noise public key |
| `expiresAt` | `number` | Expiry timestamp (max 7 days) |
| `consumed` | `boolean` | Whether the invite has been accepted |

### `RelayPair`

| Field | Type | Description |
|-------|------|-------------|
| `token` | `string` | Relay token (HMAC-verified) |
| `ws1` | `WebSocket` | First peer socket |
| `ws2` | `WebSocket?` | Second peer socket (set on pairing) |
| `createdAt` | `number` | Unix timestamp |
| `timer` | `Timeout` | Pairing timeout handle |

### `ClientMessage`

Messages sent from client to server:

| Type | Fields | Description |
|------|--------|-------------|
| `register` | `name`, `publicKey`, `noisePublicKey`, `fingerprint`, `signature`, `requestId?` | Register on signaling server (requires Ed25519 signature) |
| `unregister` | — | Unregister from signaling |
| `signal` | `to`, `data` | Forward signaling data to a peer |
| `request-relay` | `peer`, `requestId?` | Request a relay token for NAT traversal |
| `lookup` | `peer`, `requestId?` | Look up a peer's online status and keys |
| `ping` | — | Keepalive ping (server responds with `pong`) |

### `ServerMessage`

Messages sent from server to client:

| Type | Fields | Description |
|------|--------|-------------|
| `registered` | `ok`, `requestId?` | Registration confirmed |
| `signal` | `from`, `data` | Forwarded signaling data from a peer |
| `relay-token` | `token`, `relayUrl`, `requestId?` | Relay token for NAT traversal |
| `invite-accepted` | `peer`, `publicKey`, `noisePublicKey`, `fingerprint` | Notification that an invite was accepted |
| `pong` | — | Keepalive response |
| `error` | `code`, `message`, `requestId?` | Error response |
| `lookup-result` | `found`, `peer?`, `requestId?` | Peer lookup result |

## `registerSignaling(app, config, gossipCache?)`

Registers the WebSocket signaling endpoint at `/ws`. Handles node registration (with Ed25519 signature verification and public key pinning), peer signaling, lookup (with gossip cache fallback), relay token issuance, and keepalive pings. Includes per-IP rate limiting (60 messages/minute).

```ts
function registerSignaling(
  app: FastifyInstance,
  config: ServerConfig,
  gossipCache?: GossipCache,
): void
```

## `registerInviteRoutes(app, config)`

Registers HTTP routes for invite-based peer onboarding.

```ts
function registerInviteRoutes(app: FastifyInstance, config: ServerConfig): void
```

**Routes registered:**

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/invite` | Create an invite. Body: `PendingInvite` fields. Returns `429` if max pending reached |
| `GET` | `/invite/:token` | Get invite metadata. Returns `410` if consumed or expired |
| `POST` | `/invite/:token/accept` | Accept an invite. Body: `{ name, publicKey, fingerprint, noisePublicKey? }`. Notifies inviter via WebSocket if online |

## `registerRelay(app, config)`

Registers the WebSocket relay endpoint at `/relay`. Pairs two peers by a shared HMAC token for NAT traversal. Relay is a dumb bidirectional pipe -- identity enforcement happens at the Noise protocol layer.

```ts
function registerRelay(app: FastifyInstance, config: ServerConfig): void
```

**Connection flow:**
1. First peer connects with `?token=<hmac_token>` and waits (60s timeout)
2. Second peer connects with the same token
3. Bidirectional relay established (messages forwarded between peers)
4. Session terminates after `relayMaxSessionMs` (1 hour) or peer disconnect

## `registerGossip(app, opts)`

Registers the WebSocket gossip endpoint at `/gossip`. Implements a push-based gossip protocol with vector clocks for eventually-consistent peer discovery across multiple rendezvous servers.

```ts
function registerGossip(app: FastifyInstance, opts: GossipOpts): void
```

**Authentication:** Gossip peers must authenticate via a challenge-response protocol:
1. Server sends a random nonce
2. Client responds with `{ name, publicKey, signature }` where `signature` is an Ed25519 signature over the nonce
3. Server verifies the public key matches a known peer from `nodes.json`

**Gossip push:** Every 60 seconds, the server pushes local + cached peer records (with `hopCount < 3`) to all authenticated peers whose vector clocks are behind.

**`GossipMessage`** types:

| Type | Direction | Description |
|------|-----------|-------------|
| `challenge` | Server -> Client | Random nonce for authentication |
| `auth` | Client -> Server | Ed25519 signed response |
| `authenticated` | Server -> Client | Authentication confirmed |
| `gossip-push` | Bidirectional | Peer records with vector clock |

## See also

- [@mecha/connect](/reference/api/connect) — Client-side P2P connectivity that connects to this server
- [Mesh Networking](/features/mesh-networking) — User guide for mesh setup
- [API Reference](/reference/api/) — Route summary and package overview
