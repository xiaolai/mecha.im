---
title: "@mecha/server"
description: API reference for @mecha/server — rendezvous server, WebSocket signaling, relay tunneling, gossip protocol, and invite-based onboarding.
---

# @mecha/server

[[toc]]

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

## Agent Server Internals

The following symbols are exported from `@mecha/agent` (the main agent HTTP server package). They handle request authentication and meter daemon lifecycle at the agent level.

### `AuthOpts`

Configuration options for the agent authentication and signature verification hooks.

```ts
import type { AuthOpts } from "@mecha/agent";

const opts: AuthOpts = {
  sessionKey: "derived-from-totp-secret",
  apiKey: "mesh-bearer-token",
  nodePublicKeys: new Map([["alice", "-----BEGIN PUBLIC KEY-----\n..."]]),
  spaDir: "/path/to/spa/dist",
};
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionKey` | `string` | No | Session signing key derived from the TOTP secret. Omit to disable session-based auth. |
| `apiKey` | `string` | No | Internal API key for mesh node-to-node routing (used as a Bearer token). |
| `nodePublicKeys` | `Map<string, string>` | No | Map of node name to Ed25519 public key PEM. When provided, routing requests must include a valid `X-Mecha-Signature` header. |
| `verifySignature` | `(publicKey, data, signature) => boolean` | No | Signature verification function. Defaults to `@mecha/core` `verifySignature`. |
| `spaDir` | `string` | No | Directory where the SPA is served from. When set, non-API paths skip auth (static assets). |
| `spaIndexHtml` | `string` | No | Pre-read SPA `index.html` content. Used to serve the SPA shell for browser navigations to API-prefixed paths. |

At least one of `apiKey` or `sessionKey` must be provided when using `createAuthHook`.

### `getSource(request)`

Extracts the `X-Mecha-Source` header from a Fastify request. This header identifies the originating bot and node in mesh routing requests (e.g., `"coder@alice"`).

```ts
import { getSource } from "@mecha/agent";

app.addHook("preHandler", async (request, reply) => {
  const source = getSource(request);
  // source: "coder@alice" | undefined
  if (!source) {
    reply.code(400).send({ error: "Missing source header" });
    return;
  }
});
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `request` | `FastifyRequest` | The incoming Fastify request object |

**Returns:** `string | undefined` -- the value of the `X-Mecha-Source` header, or `undefined` if the header is missing or not a string.

### `startMeterDaemon(mechaDir, port?)`

Starts the meter daemon in-process. The meter daemon is an HTTP proxy that intercepts Anthropic API calls to track token usage and cost. The daemon handle is stored internally per `mechaDir` so that `stopMeterDaemon` can shut it down later.

```ts
import { startMeterDaemon } from "@mecha/agent";

const handle = await startMeterDaemon("/Users/you/.mecha");
console.log(`Meter running on port ${handle.info.port}, pid ${handle.info.pid}`);

// Later: shut down
await handle.close();
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `mechaDir` | `string` | -- | Path to the mecha configuration directory (e.g., `~/.mecha`) |
| `port` | `number` | `7600` | Port for the meter proxy to listen on |

**Returns:** `Promise<DaemonHandle>` -- resolves with the daemon handle.

**`DaemonHandle`**

| Field | Type | Description |
|-------|------|-------------|
| `server` | `Server` | The underlying Node.js HTTP server |
| `info` | `ProxyInfo` | Runtime info: `port`, `pid`, `required`, `startedAt` |
| `close` | `() => Promise<void>` | Gracefully shuts down the meter daemon |

**Throws** if the meter daemon is already running or the port is busy.

### `stopMeterDaemon(mechaDir)`

Stops a previously started meter daemon. First checks for an in-process handle (started via `startMeterDaemon`). If no in-process handle exists, falls back to stopping an external daemon process via PID file signal.

```ts
import { stopMeterDaemon } from "@mecha/agent";

const stopped = await stopMeterDaemon("/Users/you/.mecha");
if (!stopped) {
  console.error("Meter proxy was not running");
}
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `mechaDir` | `string` | Path to the mecha configuration directory |

**Returns:** `Promise<boolean>` -- `true` if the daemon was stopped, `false` if no running daemon was found.

## See also

- [@mecha/connect](/reference/api/connect) — Client-side P2P connectivity that connects to this server
- [Mesh Networking](/features/mesh-networking) — User guide for mesh setup
- [API Reference](/reference/api/) — Route summary and package overview
