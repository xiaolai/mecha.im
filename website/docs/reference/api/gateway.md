---
title: "@mecha/gateway"
description: API reference for @mecha/gateway -- credential store, circuit breakers, HTTP gateway, and service adapters.
---

# @mecha/gateway

[[toc]]

The `@mecha/gateway` package provides a file-backed credential store for secret management, circuit breakers for fault tolerance, a host-allowlisted HTTP gateway, and a registry of external service adapters.

## Barrel Exports

| Export | Kind | Source |
|--------|------|--------|
| `createCredentialStore` | Function | `credentials.ts` |
| `CredentialStore` | Type | `types.ts` |
| `StoredSecret` | Type | `types.ts` |
| `SecretGrant` | Type | `types.ts` |
| `createCircuitBreaker` | Function | `circuit-breaker.ts` |
| `CircuitOpenError` | Class | `circuit-breaker.ts` |
| `CircuitBreaker` | Type | `types.ts` |
| `CircuitBreakerOpts` | Type | `types.ts` |
| `CircuitState` | Type | `types.ts` |
| `createHttpGateway` | Function | `http-request.ts` |
| `GatewayDeniedError` | Class | `http-request.ts` |
| `HttpGateway` | Type | `http-request.ts` |
| `HttpGatewayOpts` | Type | `http-request.ts` |
| `HttpRequestOpts` | Type | `http-request.ts` |
| `HttpRequestResult` | Type | `http-request.ts` |
| `HttpMethod` | Type | `http-request.ts` |
| `ADAPTER_REGISTRY` | Object | `adapters.ts` -- registry of all built-in adapters |
| `githubAdapter` | Object | `adapters.ts` |
| `slackAdapter` | Object | `adapters.ts` |
| `emailAdapter` | Object | `adapters.ts` |
| `discordAdapter` | Object | `adapters.ts` |
| `linearAdapter` | Object | `adapters.ts` |
| `GatewayAdapter` | Type | `adapters.ts` |
| `AdapterConfig` | Type | `adapters.ts` |
| `InboundEvent` | Type | `adapters.ts` |
| `OutboundMessage` | Type | `adapters.ts` |
| `OutboundResult` | Type | `adapters.ts` |

## `createCredentialStore(secretsDir)`

Creates a file-backed credential store. Secrets persist to `secrets.json` and access grants to `grants.json` inside the given directory. Both files are written with mode `0600`. The directory is created recursively if it does not exist.

```ts
import { createCredentialStore } from "@mecha/gateway";

const store = createCredentialStore("/Users/you/.mecha/gateway");

// Store a secret
store.setSecret("GITHUB_TOKEN", "ghp_abc123");

// Retrieve it
const token = store.getSecret("GITHUB_TOKEN");
// "ghp_abc123"

// Grant a bot access
store.grantAccess("GITHUB_TOKEN", "coder");

// Check access
store.checkAccess("GITHUB_TOKEN", "coder"); // true
store.checkAccess("GITHUB_TOKEN", "writer"); // false

// Revoke access
store.revokeAccess("GITHUB_TOKEN", "coder"); // true

// List all secret names
store.listSecrets(); // ["GITHUB_TOKEN"]

// Delete a secret (also removes all grants for it)
store.deleteSecret("GITHUB_TOKEN"); // true
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `secretsDir` | `string` | Directory path for secrets and grants files |

**Returns:** `CredentialStore`

### `CredentialStore`

| Method | Signature | Description |
|--------|-----------|-------------|
| `setSecret` | `(name: string, value: string) => void` | Store or update a secret. Values are base64-encoded before writing. |
| `getSecret` | `(name: string) => string \| undefined` | Retrieve a decoded secret value. Returns `undefined` if the secret does not exist. |
| `listSecrets` | `() => string[]` | List all secret names. Values are never exposed. |
| `deleteSecret` | `(name: string) => boolean` | Delete a secret and all its grants. Returns `false` if the secret was not found. |
| `grantAccess` | `(secretName: string, botName: string) => void` | Allow a bot to use a secret. Duplicate grants are silently ignored. |
| `revokeAccess` | `(secretName: string, botName: string) => boolean` | Revoke a bot's access to a secret. Returns `false` if no matching grant was found. |
| `checkAccess` | `(secretName: string, botName: string) => boolean` | Check if a bot has access to a secret. |

## `createCircuitBreaker(opts?)`

Creates a circuit breaker that wraps unreliable async calls. Tracks consecutive failures and trips after `maxFailures`. After `resetTimeoutMs`, the circuit transitions to half-open, allowing one test call through.

```ts
import { createCircuitBreaker, CircuitOpenError } from "@mecha/gateway";

const cb = createCircuitBreaker({ maxFailures: 3, resetTimeoutMs: 30_000 });

try {
  const result = await cb.execute(async () => {
    const resp = await fetch("https://api.example.com/data");
    return resp.json();
  });
} catch (err) {
  if (err instanceof CircuitOpenError) {
    // Circuit is open -- skip this call
  }
}

// Check state
cb.state; // "closed" | "open" | "half-open"

// Manually reset
cb.reset();
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `opts` | `CircuitBreakerOpts` | `{}` | Configuration options |

**Returns:** `CircuitBreaker`

### `CircuitBreakerOpts`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxFailures` | `number` | `5` | Maximum consecutive failures before the circuit trips to open |
| `resetTimeoutMs` | `number` | `60000` | Milliseconds to wait before transitioning from open to half-open |

### `CircuitBreaker`

| Member | Signature | Description |
|--------|-----------|-------------|
| `state` | `readonly CircuitState` | Current state: `"closed"`, `"open"`, or `"half-open"`. Accessing this property may trigger the open-to-half-open transition if the timeout has elapsed. |
| `execute` | `<T>(fn: () => Promise<T>) => Promise<T>` | Execute a function through the circuit breaker. Throws `CircuitOpenError` if the circuit is open. On success in half-open state, resets to closed. On failure in half-open state, returns to open. |
| `reset` | `() => void` | Manually reset the circuit to closed state, clearing the failure count. |

### `CircuitState`

```ts
type CircuitState = "closed" | "open" | "half-open";
```

### `CircuitOpenError`

Extends `Error`. Thrown by `execute()` when the circuit is in the open state. The `name` property is `"CircuitOpenError"`.

## `createHttpGateway(opts)`

Creates an HTTP gateway that enforces a host allowlist and applies per-host circuit breakers to outbound requests. Each unique hostname gets its own circuit breaker instance. Requests to hosts not matching any allowed pattern are rejected immediately.

```ts
import { createHttpGateway, GatewayDeniedError, CircuitOpenError } from "@mecha/gateway";

const gw = createHttpGateway({
  allowedHosts: ["api.github.com", "*.slack.com"],
  maxFailures: 3,
  resetTimeoutMs: 30_000,
});

// GET request
const result = await gw.executeRequest("https://api.github.com/repos/owner/repo");
// { status: 200, headers: { ... }, body: "..." }

// POST request with body and headers
const posted = await gw.executeRequest("https://hooks.slack.com/services/xxx", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ text: "Hello from Mecha" }),
});

// Denied host throws GatewayDeniedError
try {
  await gw.executeRequest("https://evil.example.com/steal");
} catch (err) {
  // GatewayDeniedError: Host not allowed: evil.example.com
}
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `opts` | `HttpGatewayOpts` | Gateway configuration |

**Returns:** `HttpGateway`

### `HttpGatewayOpts`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `allowedHosts` | `string[]` | -- (required) | URL host patterns to allow. Supports exact match (`"api.github.com"`) and wildcard prefix (`"*.example.com"`). |
| `maxFailures` | `number` | `5` | Consecutive failures per host before circuit trips |
| `resetTimeoutMs` | `number` | `60000` | Milliseconds before open circuit transitions to half-open |

### `HttpGateway`

| Method | Signature | Description |
|--------|-----------|-------------|
| `executeRequest` | `(url: string, opts?: HttpRequestOpts) => Promise<HttpRequestResult>` | Execute an HTTP request. Throws `GatewayDeniedError` if the host is not allowed, or `CircuitOpenError` if the per-host circuit is open. Uses `fetch()` with `redirect: "manual"`. |

### `HttpRequestOpts`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `method` | `HttpMethod` | `"GET"` | HTTP method |
| `headers` | `Record<string, string>` | -- | Request headers |
| `body` | `string` | -- | Request body (ignored for GET requests) |

### `HttpMethod`

```ts
type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";
```

### `HttpRequestResult`

| Field | Type | Description |
|-------|------|-------------|
| `status` | `number` | HTTP status code |
| `headers` | `Record<string, string>` | Response headers |
| `body` | `string` | Response body as text |

### `GatewayDeniedError`

Extends `Error`. Thrown when a request URL hostname does not match any pattern in `allowedHosts`. Also thrown when the URL cannot be parsed. The `name` property is `"GatewayDeniedError"`. For invalid URLs, the message includes the full URL string rather than a hostname.

## Adapters

### `GatewayAdapter`

The interface that all service adapters implement. All methods are optional.

| Method | Signature | Description |
|--------|-----------|-------------|
| `name` | `readonly string` | Adapter name (e.g., `"github"`, `"slack"`) |
| `parseWebhook` | `(headers: Record<string, string>, body: unknown) => InboundEvent \| null` | Parse an inbound webhook payload into a structured event. Returns `null` if the payload is not recognized. |
| `send` | `(message: OutboundMessage) => Promise<OutboundResult>` | Send an outbound message to the service. |
| `verifySignature` | `(headers: Record<string, string>, body: string, secret: string) => boolean` | Verify a webhook signature. |

### `InboundEvent`

| Field | Type | Description |
|-------|------|-------------|
| `adapter` | `string` | Adapter name that produced the event |
| `event` | `string` | Event type (e.g., `"push"`, `"pull_request"`) |
| `payload` | `Record<string, unknown>` | Parsed event payload |
| `receivedAt` | `string` | ISO 8601 timestamp when the event was received |

### `OutboundMessage`

| Field | Type | Description |
|-------|------|-------------|
| `adapter` | `string` | Target adapter name |
| `action` | `string` | Action to perform (e.g., `"send_message"`, `"create_issue"`) |
| `params` | `Record<string, unknown>` | Action-specific parameters |

### `OutboundResult`

| Field | Type | Description |
|-------|------|-------------|
| `success` | `boolean` | Whether the action succeeded |
| `response` | `unknown?` | Service-specific response data |
| `error` | `string?` | Error message if the action failed |

### `AdapterConfig`

Configuration for an adapter instance, typically loaded from an adapters configuration file.

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"webhook" \| "websocket" \| "poll"` | Connection type |
| `path` | `string?` | Webhook endpoint path |
| `secret` | `string?` | Webhook signing secret |
| `token` | `string?` | API token for outbound calls |
| `mappings` | `Array<{ event, topic, filter?, payload? }>?` | Event-to-topic mappings |

### Built-in Adapters

#### `githubAdapter`

Parses GitHub webhook payloads. Reads the `X-GitHub-Event` header to determine the event type and wraps the body into an `InboundEvent`.

```ts
import { githubAdapter } from "@mecha/gateway";

const event = githubAdapter.parseWebhook?.(
  { "x-github-event": "push" },
  { ref: "refs/heads/main", commits: [...] },
);
// { adapter: "github", event: "push", payload: { ref: "refs/heads/main", ... }, receivedAt: "..." }
```

#### `slackAdapter`

Stub adapter for Slack. Implements the `GatewayAdapter` interface with `name: "slack"`. Send and webhook parsing to be implemented when `SLACK_BOT_TOKEN` is available.

#### `emailAdapter`

Stub adapter for Email (IMAP/SMTP). Implements the `GatewayAdapter` interface with `name: "email"`. To be implemented when IMAP/SMTP credentials are available.

#### `discordAdapter`

Stub adapter for Discord. Implements the `GatewayAdapter` interface with `name: "discord"`. To be implemented when `DISCORD_BOT_TOKEN` is available.

#### `linearAdapter`

Stub adapter for Linear. Implements the `GatewayAdapter` interface with `name: "linear"`. To be implemented when `LINEAR_API_KEY` is available.

### `ADAPTER_REGISTRY`

```ts
const ADAPTER_REGISTRY: Record<string, GatewayAdapter>
```

A map of all built-in adapters keyed by name: `github`, `slack`, `email`, `discord`, `linear`.

## Types

### `StoredSecret`

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Unique secret identifier |
| `value` | `string` | Base64-encoded secret value |
| `createdAt` | `string` | ISO 8601 creation timestamp |
| `updatedAt` | `string` | ISO 8601 last-update timestamp |

### `SecretGrant`

| Field | Type | Description |
|-------|------|-------------|
| `secretName` | `string` | Name of the secret |
| `botName` | `string` | Name of the bot with access |
| `grantedAt` | `string` | ISO 8601 grant timestamp |

## See also

- [Gateway Feature Guide](/features/gateway) -- Overview of credential store, circuit breakers, and adapters
- [Message Bus](/features/bus) -- Pub/sub topics that adapters publish events to
- [@mecha/server](/reference/api/server) -- Rendezvous server and signaling
- [CLI Reference](/reference/cli/) -- `mecha secret` commands
