---
title: "@mecha/core"
description: API reference for @mecha/core — types, schemas, validation, ACL engine, identity, logging, discovery, and shared utilities.
---

# @mecha/core

Shared utility functions, types, and schemas re-exported from the `@mecha/core` barrel.

[[toc]]

## Logging

### `createLogger(namespace): Logger`

Create a structured JSON logger that writes to stderr. Respects the `MECHA_LOG_LEVEL` environment variable (`debug`, `info`, `warn`, `error`; default: `info`).

```ts
import { createLogger } from "@mecha/core";

const log = createLogger("mecha:agent");
log.info("Server started", { port: 7660 });
// stderr: {"ts":"2026-03-06T...","level":"info","ns":"mecha:agent","msg":"Server started","data":{"port":7660}}
```

**`Logger`**

| Method | Description |
|--------|-------------|
| `debug(msg, data?)` | Debug-level message (suppressed unless `MECHA_LOG_LEVEL=debug`) |
| `info(msg, data?)` | Informational message (default threshold) |
| `warn(msg, data?)` | Warning message |
| `error(msg, data?)` | Error message |

The logger automatically redacts sensitive keys (`token`, `authorization`, `apikey`, `api_key`, `secret`, `password`, `credential`) from the `data` object up to 3 levels deep.

### `resetLogLevel(): void`

Reset the cached log level threshold. Used in tests to pick up changes to `MECHA_LOG_LEVEL`.

## Safe File Reading

### `safeReadJson<T>(path, label, schema?): SafeReadResult<T>`

Safely read and parse a JSON file. Returns a discriminated union instead of throwing, so callers can decide how to handle errors.

```ts
import { safeReadJson } from "@mecha/core";

const result = safeReadJson("/path/to/config.json", "bot config");
if (result.ok) {
  console.log(result.data);
} else {
  console.error(result.reason, result.detail);
}
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | `string` | Absolute file path |
| `label` | `string` | Human-readable label for error messages |
| `schema` | `ZodType<T>?` | Optional Zod schema for validation |

**`SafeReadResult<T>`**

```ts
type SafeReadResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "missing" | "corrupt" | "unreadable"; detail: string };
```

| Reason | Condition |
|--------|-----------|
| `missing` | File does not exist (`ENOENT`) |
| `corrupt` | File exists but contains invalid JSON or fails schema validation |
| `unreadable` | File exists but cannot be read (permission error, etc.) |

## Node Information

### `getNetworkIps(): { lanIp?: string; tailscaleIp?: string }`

Detect the machine's LAN and Tailscale IPv4 addresses by scanning network interfaces. Returns `undefined` for either if not found.

- **LAN IP**: First IPv4 address in RFC 1918 private ranges (`10.x`, `172.16-31.x`, `192.168.x`)
- **Tailscale IP**: First IPv4 address in the CGNAT range used by Tailscale (`100.64-127.x`)

### `fetchPublicIp(): Promise<string | undefined>`

Fetch the machine's public IP by querying external providers (`ifconfig.me`, `api.ipify.org`). Returns `undefined` if all providers fail. Each request has a 3-second timeout.

### `collectNodeInfo(opts): NodeInfo`

Collect complete system telemetry for the `/node/info` endpoint.

```ts
import { collectNodeInfo } from "@mecha/core";

const info = collectNodeInfo({
  port: 7660,
  startedAt: new Date().toISOString(),
  botCount: 3,
  publicIp: "203.0.113.1",
});
```

**`NodeInfo`**

| Field | Type | Description |
|-------|------|-------------|
| `hostname` | `string` | Machine hostname |
| `platform` | `string` | OS platform (`darwin`, `linux`, etc.) |
| `arch` | `string` | CPU architecture (`arm64`, `x64`, etc.) |
| `port` | `number` | Agent server port |
| `uptimeSeconds` | `number` | Process uptime in seconds |
| `startedAt` | `string` | ISO timestamp of server start |
| `botCount` | `number` | Number of bots managed |
| `totalMemMB` | `number` | Total system memory in MB |
| `freeMemMB` | `number` | Free system memory in MB |
| `cpuCount` | `number` | Number of CPU cores |
| `lanIp` | `string?` | LAN IPv4 address |
| `tailscaleIp` | `string?` | Tailscale IPv4 address |
| `publicIp` | `string?` | Public IPv4 address |

### `formatUptime(seconds): string`

Format a duration in seconds to a human-readable string.

```ts
import { formatUptime } from "@mecha/core";

formatUptime(90);     // "1m"
formatUptime(3700);   // "1h 1m"
formatUptime(90000);  // "1d 1h"
```

### `wsToHttp(url): string`

Convert a `ws://` or `wss://` URL to the corresponding `http://` or `https://` URL.

## Tailscale Scanner

**Source:** `packages/core/src/tailscale-scanner.ts`

Discover peers on the Tailscale overlay network by parsing `tailscale status --json` output.

### `TailscalePeer`

```ts
interface TailscalePeer {
  ip: string;
  hostname: string;
}
```

| Field | Type | Description |
|-------|------|-------------|
| `ip` | `string` | Tailscale IPv4 address of the peer |
| `hostname` | `string` | Hostname reported by Tailscale (falls back to IP if unavailable) |

### `parseTailscaleStatus(json)`

```ts
function parseTailscaleStatus(json: TailscaleStatusJson): TailscalePeer[]
```

Parse `tailscale status --json` output and return online peers, excluding the local node. Filters out offline peers and peers without a Tailscale IP.

| Parameter | Type | Description |
|-----------|------|-------------|
| `json` | `TailscaleStatusJson` | Parsed JSON output from `tailscale status --json` |

```ts
import { parseTailscaleStatus } from "@mecha/core";

const status = JSON.parse(stdout);
const peers = parseTailscaleStatus(status);
// [{ ip: "100.100.1.9", hostname: "linode02" }, ...]
```

### `scanTailscalePeers()`

```ts
function scanTailscalePeers(): Promise<TailscalePeer[]>
```

Run `tailscale status --json` and return online peers. Returns an empty array if Tailscale is not installed, not running, or the command fails. Has a 5-second timeout.

```ts
import { scanTailscalePeers } from "@mecha/core";

const peers = await scanTailscalePeers();
for (const peer of peers) {
  console.log(`${peer.hostname} at ${peer.ip}`);
}
```

## Host Validation

**Source:** `packages/core/src/host-validation.ts`

Functions for validating host addresses, primarily used for SSRF protection in outbound agent-to-agent communication.

### `isPrivateHost(host)`

```ts
function isPrivateHost(host: string): boolean
```

Returns `true` if the host looks like a private or loopback address. Checks `localhost`, RFC 1918 IPv4 ranges, link-local, loopback, and IPv6 equivalents (including IPv4-mapped IPv6 like `::ffff:127.0.0.1`). Hostnames that resolve to private IPs via DNS are not caught (DNS resolution is out of scope for a synchronous check).

| Parameter | Type | Description |
|-----------|------|-------------|
| `host` | `string` | IP address, hostname, or bracketed IPv6 literal |

```ts
import { isPrivateHost } from "@mecha/core";

isPrivateHost("localhost");         // true
isPrivateHost("127.0.0.1");        // true
isPrivateHost("10.0.0.1");         // true
isPrivateHost("::1");              // true
isPrivateHost("::ffff:127.0.0.1"); // true
isPrivateHost("203.0.113.1");      // false
isPrivateHost("example.com");      // false
```

### `validateRemoteHost(host)`

```ts
function validateRemoteHost(host: string): void
```

Validate a host for outbound agent-to-agent communication. Throws if the host is a private or loopback address (SSRF protection).

| Parameter | Type | Description |
|-----------|------|-------------|
| `host` | `string` | IP address or hostname to validate |

**Throws:** `Error` with message `"Refusing to connect to private/loopback address: <host>"` if the host is private.

```ts
import { validateRemoteHost } from "@mecha/core";

validateRemoteHost("203.0.113.1");  // OK
validateRemoteHost("127.0.0.1");    // throws Error
```

## Safe Path

**Source:** `packages/core/src/safe-path.ts`

Path traversal protection for sandboxed filesystem operations.

### `safePath(baseDir, relativePath)`

```ts
function safePath(baseDir: string, relativePath: string): string
```

Resolve a relative path against a base directory and verify the result stays within the base. Performs both a lexical check (fast path) and a symlink-aware check (resolves real paths to catch symlink escapes). Returns the absolute resolved path. Passing an empty string resolves to the base directory itself.

| Parameter | Type | Description |
|-----------|------|-------------|
| `baseDir` | `string` | Base directory that the path must stay within |
| `relativePath` | `string` | Relative path to resolve |

**Throws:** `PathTraversalError` if the resolved path escapes the base directory.

```ts
import { safePath } from "@mecha/core";

safePath("/home/alice/project", "src/index.ts");
// "/home/alice/project/src/index.ts"

safePath("/home/alice/project", "../../etc/passwd");
// throws PathTraversalError
```

### `PathTraversalError`

```ts
class PathTraversalError extends Error {
  name: "PathTraversalError";
}
```

Thrown by `safePath` when the resolved path escapes the base directory. Message format: `"Path traversal denied: <path>"`.

## Error Mapping

**Source:** `packages/core/src/mapping.ts`

Utility functions for extracting user-facing error messages from unknown error values.

### `toUserMessage(err)`

```ts
function toUserMessage(err: unknown): string
```

Extract a user-facing error message from any error value. Returns `err.message` for `MechaError` and standard `Error` instances, or `String(err)` for other values.

| Parameter | Type | Description |
|-----------|------|-------------|
| `err` | `unknown` | The error value to extract a message from |

```ts
import { toUserMessage } from "@mecha/core";

toUserMessage(new Error("file not found")); // "file not found"
toUserMessage("something broke");           // "something broke"
```

### `toSafeMessage(err)`

```ts
function toSafeMessage(err: unknown): string
```

Extract a safe error message that strips stack traces and internal details. Returns the message for `MechaError` instances, `"Internal error"` for standard `Error` instances, and `"Unknown error"` for other values.

| Parameter | Type | Description |
|-----------|------|-------------|
| `err` | `unknown` | The error value to extract a message from |

```ts
import { toSafeMessage } from "@mecha/core";

toSafeMessage(new MechaError("bot not found", { code: "NOT_FOUND" })); // "bot not found"
toSafeMessage(new TypeError("Cannot read property 'x' of undefined")); // "Internal error"
```

## Plugin Environment Resolution

**Source:** `packages/core/src/plugin-resolve.ts`

Resolve `${VAR}` and `${VAR:-default}` placeholders in plugin environment variable maps.

### `resolveEnvVars(vars)`

```ts
function resolveEnvVars(vars: Record<string, string>): Record<string, string>
```

Resolve `${VAR}` and `${VAR:-default}` placeholders in a record of strings, reading values from `process.env`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `vars` | `Record<string, string>` | Key-value map with possible `${VAR}` placeholders |

**Throws:** `PluginEnvError` if a variable is unresolved and has no default.

```ts
import { resolveEnvVars } from "@mecha/core";

// With process.env.API_KEY = "sk-123"
resolveEnvVars({ token: "${API_KEY}", host: "${HOST:-localhost}" });
// { token: "sk-123", host: "localhost" }
```

### `resolveEnvString(str)`

```ts
function resolveEnvString(value: string): string
```

Resolve `${VAR}` and `${VAR:-default}` placeholders in a single string value, reading from `process.env`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `value` | `string` | String with possible `${VAR}` placeholders |

**Throws:** `PluginEnvError` if a variable is unresolved and has no default.

```ts
import { resolveEnvString } from "@mecha/core";

// With process.env.PORT = "8080"
resolveEnvString("http://localhost:${PORT}"); // "http://localhost:8080"
resolveEnvString("${MISSING:-fallback}");     // "fallback"
resolveEnvString("${MISSING}");               // throws PluginEnvError
```

## Input Schemas

**Source:** `packages/core/src/schemas.ts`

Zod schemas for validating CLI and HTTP input payloads.

### `PermissionMode`

```ts
const PermissionMode: z.ZodEnum<["default", "plan", "full-auto"]>;
type PermissionMode = "default" | "plan" | "full-auto";
```

Permission modes for bot processes. Controls how the Claude SDK handles permission prompts.

| Value | Description |
|-------|-------------|
| `"default"` | Standard permission handling (prompts for confirmation) |
| `"plan"` | Plan mode (read-only, no writes) |
| `"full-auto"` | Bypass all permission prompts |

### `BotSpawnInput`

```ts
const BotSpawnInput: z.ZodObject<{
  name: z.ZodString;
  workspacePath: z.ZodString;
  tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
  env: z.ZodOptional<z.ZodRecord<z.ZodString>>;
  model: z.ZodOptional<z.ZodString>;
  permissionMode: z.ZodOptional<typeof PermissionMode>;
  port: z.ZodOptional<z.ZodNumber>;
  auth: z.ZodOptional<z.ZodString>;
}>;
```

Validation schema for bot spawn requests.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Bot name (lowercase alphanumeric + hyphens, 1-32 chars) |
| `workspacePath` | `string` | Yes | Workspace directory path |
| `tags` | `string[]` | No | Discovery tags |
| `env` | `Record<string, string>` | No | Additional environment variables |
| `model` | `string` | No | Claude model override |
| `permissionMode` | `PermissionMode` | No | Permission mode |
| `port` | `number` | No | Specific port (1-65535) |
| `auth` | `string` | No | Auth profile name |

```ts
import { BotSpawnInput } from "@mecha/core";

BotSpawnInput.parse({ name: "researcher", workspacePath: "/home/alice/project" });
```

### `BotKillInput`

```ts
const BotKillInput: z.ZodObject<{
  name: z.ZodString;
  force: z.ZodOptional<z.ZodBoolean>;
}>;
```

Validation schema for bot kill requests.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Bot name |
| `force` | `boolean` | No | Force kill (SIGKILL instead of SIGTERM) |

### `SessionCreateInput`

```ts
const SessionCreateInput: z.ZodObject<{
  title: z.ZodOptional<z.ZodString>;
  model: z.ZodOptional<z.ZodString>;
}>;
```

Validation schema for session creation requests.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | `string` | No | Session title |
| `model` | `string` | No | Claude model override |

### `SessionMessageInput`

```ts
const SessionMessageInput: z.ZodObject<{
  message: z.ZodString;
  model: z.ZodOptional<z.ZodString>;
}>;
```

Validation schema for sending a message to a session.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `message` | `string` | Yes | Message content (min 1 character) |
| `model` | `string` | No | Claude model override |

## Models

**Source:** `packages/core/src/models.ts`

Available Claude model definitions for bot spawning and model selection.

### `ModelOption`

```ts
interface ModelOption {
  id: string;
  label: string;
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Model identifier passed to the Claude SDK |
| `label` | `string` | Human-readable display label |

### `CLAUDE_MODELS`

```ts
const CLAUDE_MODELS: ModelOption[]
```

List of available Claude models. Update this list when new models are released or old ones are retired.

| Model ID | Label |
|----------|-------|
| `claude-sonnet-4-5-20250514` | Sonnet 4.5 |
| `claude-sonnet-4-6` | Sonnet 4.6 |
| `claude-opus-4-6` | Opus 4.6 |
| `claude-haiku-4-5-20251001` | Haiku 4.5 |

```ts
import { CLAUDE_MODELS } from "@mecha/core";

for (const model of CLAUDE_MODELS) {
  console.log(`${model.label}: ${model.id}`);
}
```

## Discovery Types

**Source:** `packages/core/src/discovery.ts`

These types and functions power bot discovery across the mesh, enabling queries like `+research` (all bots tagged "research").

### `DiscoverableEntry`

```ts
interface DiscoverableEntry {
  tags: string[];
  expose: string[];
}
```

A bot entry that can be matched against discovery filters.

### `DiscoveryFilter`

```ts
interface DiscoveryFilter {
  tag?: string;
  tags?: string[];
  capability?: string;
}
```

Filter criteria for discovering bots. All specified fields are AND-ed together.

| Field | Description |
|-------|-------------|
| `tag` | Entry must have this single tag. |
| `tags` | Entry must have ALL of these tags. |
| `capability` | Entry must expose this capability (in its `expose` list). |

### `DiscoveryIndex`

```ts
interface DiscoveryIndex {
  version: 1;
  updatedAt: string;
  bots: DiscoveryIndexEntry[];
}
```

The discovery index file persisted at `mechaDir/discovery.json`.

### `DiscoveryIndexEntry`

```ts
interface DiscoveryIndexEntry {
  name: string;
  tags: string[];
  expose: string[];
  state: string;
}
```

A single bot entry in the discovery index.

### `matchesDiscoveryFilter(entry, filter)`

```ts
function matchesDiscoveryFilter(entry: DiscoverableEntry, filter: DiscoveryFilter): boolean
```

Returns `true` if the entry matches all provided filter criteria.

**Example:**

```ts
import { matchesDiscoveryFilter } from "@mecha/core";

const entry = { tags: ["research", "data"], expose: ["query"] };

matchesDiscoveryFilter(entry, { tag: "research" });           // true
matchesDiscoveryFilter(entry, { tags: ["research", "data"] }); // true
matchesDiscoveryFilter(entry, { capability: "query" });        // true
matchesDiscoveryFilter(entry, { tag: "dev" });                 // false
```

## Discovered Node Registry

**Source:** `packages/core/src/discovered-registry.ts`

The discovered node registry manages nodes found via auto-discovery (Tailscale scan, mDNS). These nodes are stored in `nodes-discovered.json`, separate from manually added nodes in `nodes.json`.

### `DiscoveredNode`

```ts
interface DiscoveredNode {
  name: string;
  host: string;
  port: number;
  apiKey: string;
  fingerprint?: string;
  source: "tailscale" | "mdns";
  lastSeen: string;   // ISO 8601 datetime
  addedAt: string;     // ISO 8601 datetime
}
```

| Field | Description |
|-------|-------------|
| `name` | Node name (unique identifier). |
| `host` | IP address or hostname of the discovered node. |
| `port` | Agent server port (typically 7660). |
| `apiKey` | API key exchanged during the discovery handshake. |
| `fingerprint` | Optional Ed25519 fingerprint (16-char hex). |
| `source` | How the node was discovered: `"tailscale"` (Tailscale peer scan) or `"mdns"` (mDNS, future). |
| `lastSeen` | ISO 8601 timestamp of the last successful health check. |
| `addedAt` | ISO 8601 timestamp of when the node was first discovered. |

### `readDiscoveredNodes(mechaDir)`

```ts
function readDiscoveredNodes(mechaDir: string): DiscoveredNode[]
```

Read all discovered nodes from `nodes-discovered.json`. Returns an empty array if the file does not exist or contains invalid data.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `mechaDir` | `string` | Path to the `.mecha` directory. |

**Example:**

```ts
import { readDiscoveredNodes } from "@mecha/core";

const nodes = readDiscoveredNodes("/home/alice/.mecha");
for (const node of nodes) {
  console.log(`${node.name} at ${node.host}:${node.port} (${node.source})`);
}
```

### `writeDiscoveredNode(mechaDir, node)`

```ts
function writeDiscoveredNode(mechaDir: string, node: DiscoveredNode): void
```

Write or update a discovered node entry. If a node with the same name already exists, its fields are updated (except `addedAt`, which is preserved from the original entry). Uses atomic file write (write to temp file, then rename).

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `mechaDir` | `string` | Path to the `.mecha` directory. |
| `node` | `DiscoveredNode` | The node entry to write. Validated against the Zod schema before writing. |

**Example:**

```ts
import { writeDiscoveredNode } from "@mecha/core";

writeDiscoveredNode("/home/alice/.mecha", {
  name: "bob",
  host: "100.100.1.9",
  port: 7660,
  apiKey: "exchanged-key",
  source: "tailscale",
  lastSeen: new Date().toISOString(),
  addedAt: new Date().toISOString(),
});
```

### `refreshDiscoveredNodes(mechaDir, hosts, lastSeen)`

```ts
function refreshDiscoveredNodes(mechaDir: string, hosts: Set<string>, lastSeen: string): number
```

Bulk-update `lastSeen` timestamps for nodes matching the given hosts. Performs a single file write for efficiency.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `mechaDir` | `string` | Path to the `.mecha` directory. |
| `hosts` | `Set<string>` | Set of host addresses to match. |
| `lastSeen` | `string` | ISO 8601 timestamp to set as the new `lastSeen`. |

**Returns:** The number of nodes that were updated.

### `removeDiscoveredNode(mechaDir, name)`

```ts
function removeDiscoveredNode(mechaDir: string, name: string): boolean
```

Remove a discovered node by name. Returns `false` if the node was not found.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `mechaDir` | `string` | Path to the `.mecha` directory. |
| `name` | `string` | Name of the node to remove. |

### `cleanupExpiredNodes(mechaDir, ttlMs)`

```ts
function cleanupExpiredNodes(mechaDir: string, ttlMs: number): string[]
```

Remove nodes whose `lastSeen` timestamp is older than `ttlMs` milliseconds ago. Returns the names of removed nodes.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `mechaDir` | `string` | Path to the `.mecha` directory. |
| `ttlMs` | `number` | Time-to-live in milliseconds. Nodes not seen within this window are removed. |

**Example:**

```ts
import { cleanupExpiredNodes } from "@mecha/core";

// Remove nodes not seen in the last hour
const removed = cleanupExpiredNodes("/home/alice/.mecha", 60 * 60 * 1000);
console.log("Removed expired nodes:", removed);
```

### `promoteDiscoveredNode(mechaDir, name)`

```ts
function promoteDiscoveredNode(mechaDir: string, name: string): NodeEntry | undefined
```

Promote a discovered node to the manual `nodes.json` registry. The node is removed from `nodes-discovered.json` and added to `nodes.json` (if not already present). Returns the new `NodeEntry`, or `undefined` if the node was not found in discovered nodes.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `mechaDir` | `string` | Path to the `.mecha` directory. |
| `name` | `string` | Name of the discovered node to promote. |

**Example:**

```ts
import { promoteDiscoveredNode } from "@mecha/core";

const entry = promoteDiscoveredNode("/home/alice/.mecha", "bob");
if (entry) {
  console.log(`Promoted ${entry.name} to manual node`);
}
```

## ACL

**Source:** `packages/core/src/acl/`

The ACL (Access Control List) engine mediates all inter-agent communication using capability-based access control.

### `Capability`

```ts
type Capability =
  | "query"
  | "read_workspace"
  | "write_workspace"
  | "execute"
  | "read_sessions"
  | "lifecycle";
```

### `AclRule`

```ts
interface AclRule {
  source: string;
  target: string;
  capabilities: Capability[];
}
```

### `AclResult`

```ts
type AclResult =
  | { allowed: true }
  | { allowed: false; reason: "no_connect" | "not_exposed" };
```

| Reason | Condition |
|--------|-----------|
| `no_connect` | No ACL rule grants this capability from source to target |
| `not_exposed` | Rule exists, but target does not expose the capability |

### `AclEngine`

```ts
interface AclEngine {
  grant(source: string, target: string, caps: Capability[]): void;
  revoke(source: string, target: string, caps: Capability[]): void;
  check(source: string, target: string, cap: Capability): AclResult;
  listRules(): AclRule[];
  listConnections(source: string): { target: string; caps: Capability[] }[];
  save(): void;
}
```

### `createAclEngine(opts): AclEngine`

Create an ACL engine backed by `mechaDir/acl.json`.

```ts
import { createAclEngine } from "@mecha/core";

const acl = createAclEngine({ mechaDir: "/home/alice/.mecha" });
acl.grant("coder", "reviewer", ["query"]);
acl.save();

const result = acl.check("coder", "reviewer", "query");
// { allowed: true }
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `mechaDir` | `string` | Path to the `.mecha` directory |
| `getExpose` | `(name: string) => Capability[]` | Optional override for reading expose config (defaults to reading bot `config.json`) |

### `isCapability(s): boolean`

Returns `true` if the string is a valid `Capability` value.

### `ALL_CAPABILITIES`

```ts
const ALL_CAPABILITIES: readonly Capability[]
```

Array of all valid capability strings: `"query"`, `"read_workspace"`, `"write_workspace"`, `"execute"`, `"read_sessions"`, `"lifecycle"`.

### `AclData`

```ts
interface AclData {
  version: number;
  rules: AclRule[];
}
```

| Field | Type | Description |
|-------|------|-------------|
| `version` | `number` | Schema version (currently `1`) |
| `rules` | `AclRule[]` | Array of ACL rules |

### `loadAcl(mechaDir): AclData`

Load ACL rules from `mechaDir/acl.json`. Returns an empty ruleset (`{ version: 1, rules: [] }`) if the file is missing or fails schema validation. Logs an error for corrupt or unreadable files (but does not for missing files).

```ts
import { loadAcl } from "@mecha/core";

const aclData = loadAcl("/home/alice/.mecha");
console.log(`${aclData.rules.length} ACL rules loaded`);
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mechaDir` | `string` | Yes | Path to the `.mecha` directory |

**Source:** `packages/core/src/acl/persistence.ts`

### `saveAcl(mechaDir, data): void`

Save ACL rules to `mechaDir/acl.json` using an atomic write (write to temp file, then rename). The file is written with mode `0o600` (owner read/write only).

```ts
import { loadAcl, saveAcl } from "@mecha/core";

const data = loadAcl("/home/alice/.mecha");
data.rules.push({ source: "coder", target: "reviewer", capabilities: ["query"] });
saveAcl("/home/alice/.mecha", data);
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mechaDir` | `string` | Yes | Path to the `.mecha` directory |
| `data` | `AclData` | Yes | ACL data to persist |

**Source:** `packages/core/src/acl/persistence.ts`

## Sandbox

**Source:** `packages/sandbox/src/`

The `@mecha/sandbox` package provides OS-level process isolation.

### `SandboxPlatform`

```ts
type SandboxPlatform = "macos" | "linux" | "fallback";
```

### `SandboxProfile`

```ts
interface SandboxProfile {
  readPaths: string[];       // Paths the bot can read
  writePaths: string[];      // Paths the bot can write
  allowedProcesses: string[]; // Executables the bot may run
  allowNetwork: boolean;     // Whether network access is permitted
}
```

### `Sandbox`

```ts
interface Sandbox {
  platform: SandboxPlatform;
  isAvailable(): boolean;
  wrap(profile: SandboxProfile, runtimeBin: string, runtimeArgs: string[], botDir: string): Promise<SandboxWrapResult>;
  describe(): string;
}
```

### `SandboxWrapResult`

```ts
interface SandboxWrapResult {
  bin: string;    // Binary to execute (e.g. "sandbox-exec", "bwrap")
  args: string[]; // Arguments for the binary
}
```

### `createSandbox(platform?): Sandbox`

Create a sandbox instance for the current (or specified) platform.

```ts
import { createSandbox } from "@mecha/sandbox";

const sandbox = createSandbox();
console.log(sandbox.describe()); // "macOS sandbox-exec (available)"
```

### `detectPlatform(): SandboxPlatform`

Detect the current OS platform (`macos`, `linux`, or `fallback`).

### `checkAvailability(platform): boolean`

Check if the kernel sandbox tool is available (`sandbox-exec` on macOS, `bwrap` on Linux).

### `profileFromConfig(opts): SandboxProfile`

Generate a `SandboxProfile` from a bot's configuration (workspace path, bot directory, allowed executables).

## Scheduling

**Source:** `packages/core/src/schedule.ts`

Types and schemas for the built-in cron-like scheduler.

### `ScheduleEntry`

```ts
interface ScheduleEntry {
  id: string;           // Unique schedule ID (lowercase alphanumeric + hyphens)
  trigger: {
    type: "interval";
    every: string;      // Human-readable interval ("5m", "1h", "30s")
    intervalMs: number; // Parsed interval in milliseconds
  };
  prompt: string;       // Message sent to the agent on each run
  paused?: boolean;     // Whether the schedule is paused
}
```

### `ScheduleRunResult`

```ts
interface ScheduleRunResult {
  scheduleId: string;
  startedAt: string;     // ISO timestamp
  completedAt: string;   // ISO timestamp
  durationMs: number;
  outcome: "success" | "error" | "skipped";
  error?: string;
}
```

### `ScheduleConfig`

```ts
interface ScheduleConfig {
  schedules: ScheduleEntry[];
  maxRunsPerDay?: number;  // Default: 50
  maxConcurrent?: 1;       // Currently only 1 supported
}
```

### `ScheduleState`

```ts
interface ScheduleState {
  nextRunAt?: string;
  lastRunAt?: string;
  runCount: number;
  todayDate: string;
  runsToday: number;
  consecutiveErrors?: number;
}
```

### `parseInterval(input): number | undefined`

Parse a human-readable interval string to milliseconds. Returns `undefined` for invalid input.

```ts
import { parseInterval } from "@mecha/core";

parseInterval("5m");  // 300000
parseInterval("1h");  // 3600000
parseInterval("30s"); // 30000
parseInterval("0m");  // undefined (invalid)
```

Constraints: minimum 10s, maximum 24h.

### `SCHEDULE_DEFAULTS`

| Constant | Value | Description |
|----------|-------|-------------|
| `MAX_RUNS_PER_DAY` | 50 | Daily budget per bot |
| `MAX_CONCURRENT` | 1 | Max concurrent schedule runs |
| `MAX_CONSECUTIVE_ERRORS` | 5 | Auto-pause threshold |
| `MAX_SCHEDULES_PER_BOT` | 20 | Maximum schedules per bot |
| `MAX_HISTORY_ENTRIES` | 1000 | Maximum stored history entries |
| `RUN_TIMEOUT_MS` | 600000 | Per-run timeout (10 minutes) |

### Zod Schemas

The following Zod schemas are used for runtime validation of schedule data. Each schema corresponds to the type of the same name (e.g., `ScheduleEntrySchema` validates `ScheduleEntry`).

| Schema | Validates |
|--------|-----------|
| `ScheduleEntrySchema` | A single schedule entry (id, trigger, prompt, paused) |
| `ScheduleRunResultSchema` | A schedule run result (outcome, timing, error) |
| `ScheduleConfigSchema` | Full schedule configuration (schedules array, limits) |
| `ScheduleStateSchema` | Runtime schedule state (next/last run, counts) |

### `ScheduleAddInput`

```ts
const ScheduleAddInput: z.ZodObject<{
  id: z.ZodString;
  every: z.ZodString;
  prompt: z.ZodString;
}>;
```

Validation schema for adding a new schedule via CLI or HTTP.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Schedule ID (lowercase alphanumeric + hyphens, 1-32 chars) |
| `every` | `string` | Yes | Interval string (`"5m"`, `"1h"`, `"30s"`) |
| `prompt` | `string` | Yes | Message sent to the agent on each run |

```ts
import { ScheduleAddInput } from "@mecha/core";

ScheduleAddInput.parse({ id: "daily-report", every: "1h", prompt: "Generate the daily report" });
```

## Configuration

**Source:** `packages/core/src/mecha-settings.ts`, `packages/core/src/auth-config.ts`, `packages/core/src/plugin-registry.ts`

### `MechaSettings`

```ts
interface MechaSettings {
  forceHttps?: boolean;
}
```

### `readMechaSettings(mechaDir): MechaSettings`

Read `settings.json` from the mecha directory. Returns `{}` if the file is missing or invalid.

### `writeMechaSettings(mechaDir, settings): void`

Write settings to `settings.json` (atomic write via tmp + rename).

### `AuthConfig`

```ts
interface AuthConfig {
  totp: boolean;   // TOTP authentication (must be true)
}
```

### `readAuthConfig(mechaDir): AuthConfig`

Read `auth-config.json`. Returns `{ totp: true }` if missing.

### `writeAuthConfig(mechaDir, config): void`

Write auth config. Throws if `totp` is `false` (TOTP cannot be disabled).

### `resolveAuthConfig(mechaDir, overrides?): AuthConfig`

Merge file config with CLI flag overrides.

### `PluginRegistry`

```ts
interface PluginRegistry {
  version: 1;
  plugins: Record<string, PluginConfig>;
}
```

### `PluginConfig`

```ts
// Stdio plugin (spawns a child process)
interface StdioPluginConfig {
  type: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  description?: string;
  addedAt: string;
}

// HTTP/SSE plugin (connects to a URL)
interface HttpPluginConfig {
  type: "http" | "sse";
  url: string;
  headers?: Record<string, string>;
  description?: string;
  addedAt: string;
}

type PluginConfig = StdioPluginConfig | HttpPluginConfig;
```

### Plugin Registry Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `readPluginRegistry` | `(mechaDir) => PluginRegistry` | Read `plugins.json`. Returns empty registry if missing. |
| `writePluginRegistry` | `(mechaDir, registry) => void` | Write registry (atomic). |
| `addPlugin` | `(mechaDir, name, config, force?) => void` | Add a plugin. Throws if name exists (unless `force`). |
| `removePlugin` | `(mechaDir, name) => boolean` | Remove a plugin. Returns `false` if not found. |
| `getPlugin` | `(mechaDir, name) => PluginConfig \| undefined` | Get a single plugin config. |
| `listPlugins` | `(mechaDir) => { name, config }[]` | List all plugins. |
| `isPluginName` | `(mechaDir, name) => boolean` | Check if name is a registered plugin. |
| `pluginName` | `(input) => PluginName` | Validate and brand a string as a `PluginName`. Throws on reserved names. |

### `PLUGIN_REGISTRY_VERSION`

```ts
const PLUGIN_REGISTRY_VERSION = 1;
```

Current plugin registry schema version. Stored in `plugins.json` to support forward-compatible reads.

### `PluginConfigBase`

```ts
interface PluginConfigBase {
  description?: string;
  addedAt: string;
}
```

Base fields shared by all plugin configuration types.

| Field | Type | Description |
|-------|------|-------------|
| `description` | `string?` | Optional human-readable description |
| `addedAt` | `string` | ISO 8601 timestamp of when the plugin was added |

### Plugin Input Schemas

Zod schemas for validating plugin creation input (before `addedAt` is set).

**`StdioPluginInputSchema`** -- Validates stdio plugin input:

```ts
const StdioPluginInputSchema: z.ZodObject<{
  type: z.ZodLiteral<"stdio">;
  command: z.ZodString;
  args: z.ZodOptional<z.ZodArray<z.ZodString>>;
  env: z.ZodOptional<z.ZodRecord<z.ZodString>>;
  description: z.ZodOptional<z.ZodString>;
}>;
```

**`HttpPluginInputSchema`** -- Validates HTTP/SSE plugin input:

```ts
const HttpPluginInputSchema: z.ZodObject<{
  type: z.ZodEnum<["http", "sse"]>;
  url: z.ZodString;  // Must be a valid URL
  headers: z.ZodOptional<z.ZodRecord<z.ZodString>>;
  description: z.ZodOptional<z.ZodString>;
}>;
```

**`PluginInputSchema`** -- Discriminated union of both plugin input types:

```ts
const PluginInputSchema: z.ZodDiscriminatedUnion<"type", [
  typeof StdioPluginInputSchema,
  typeof HttpPluginInputSchema,
]>;
```

```ts
import { PluginInputSchema } from "@mecha/core";

// Validates stdio plugin
PluginInputSchema.parse({ type: "stdio", command: "node", args: ["server.js"] });

// Validates HTTP plugin
PluginInputSchema.parse({ type: "http", url: "https://example.com/mcp" });
```

### `RESERVED_PLUGIN_NAMES`

Plugin names cannot collide with built-in capabilities (`query`, `read_workspace`, etc.) or internal names (`mecha`, `__proto__`, `constructor`).

## Address & Validation

**Source:** `packages/core/src/types.ts`, `packages/core/src/address.ts`, `packages/core/src/validation.ts`

Types and functions for validated bot/node names and mesh addresses.

### `BotName`

```ts
type BotName = string & { readonly __brand: "BotName" };
```

Branded string type for validated bot names. Lowercase alphanumeric + hyphens, 1-32 chars.

### `NodeName`

```ts
type NodeName = string & { readonly __brand: "NodeName" };
```

Branded string type for validated node names. Same rules as `BotName`.

### `BotAddress`

```ts
interface BotAddress {
  readonly bot: BotName;
  readonly node: NodeName;
}
```

A resolved bot address combining a bot name and a node name.

### `GroupAddress`

```ts
interface GroupAddress {
  readonly group: string;
  readonly members: BotAddress[];
}
```

A group address (Phase 2+). Not yet supported by `parseAddress`.

### `Address`

```ts
type Address = BotAddress | GroupAddress;
```

Union of all address types.

### `botName(input)`

```ts
function botName(input: string): BotName
```

Validate and brand a string as a `BotName`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `input` | `string` | The name to validate |

**Throws:** `InvalidNameError` if the input is not a valid name.

**Source:** `packages/core/src/address.ts`

```ts
import { botName } from "@mecha/core";

const name = botName("researcher"); // BotName
botName("INVALID!");                // throws InvalidNameError
```

### `nodeName(input)`

```ts
function nodeName(input: string): NodeName
```

Validate and brand a string as a `NodeName`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `input` | `string` | The name to validate |

**Throws:** `InvalidNameError` if the input is not a valid name.

**Source:** `packages/core/src/address.ts`

### `parseAddress(input)`

```ts
function parseAddress(input: string): Address
```

Parse an address string into a structured `Address`. Unqualified names default to node `"local"`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `input` | `string` | Address string (`"bot"` or `"bot@node"`) |

**Throws:** `InvalidAddressError` on invalid input, `GroupAddressNotSupportedError` on `+group` addresses.

**Source:** `packages/core/src/address.ts`

```ts
import { parseAddress } from "@mecha/core";

parseAddress("researcher");       // { bot: "researcher", node: "local" }
parseAddress("researcher@alice"); // { bot: "researcher", node: "alice" }
parseAddress("+group");           // throws GroupAddressNotSupportedError
```

### `formatAddress(addr)`

```ts
function formatAddress(addr: BotAddress): string
```

Format a `BotAddress` back to a string. Returns `"bot"` if node is `"local"`, otherwise `"bot@node"`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `addr` | `BotAddress` | The address to format |

**Source:** `packages/core/src/address.ts`

```ts
import { formatAddress, parseAddress } from "@mecha/core";

formatAddress(parseAddress("coder@alice")); // "coder@alice"
formatAddress(parseAddress("coder"));       // "coder"
```

### `isValidName(input)`

```ts
function isValidName(input: string): boolean
```

Test if a string is a valid bot or node name. Must be lowercase alphanumeric + hyphens, 1-32 chars, no leading/trailing hyphen.

| Parameter | Type | Description |
|-----------|------|-------------|
| `input` | `string` | The string to validate |

**Source:** `packages/core/src/validation.ts`

```ts
import { isValidName } from "@mecha/core";

isValidName("my-bot");   // true
isValidName("");          // false
isValidName("UPPER");     // false
isValidName("-leading");  // false
```

### `isValidAddress(input)`

```ts
function isValidAddress(input: string): boolean
```

Test if a string is a valid address: bare name (`"coder"`) or `name@node` (`"coder@alice"`).

| Parameter | Type | Description |
|-----------|------|-------------|
| `input` | `string` | The string to validate |

**Source:** `packages/core/src/validation.ts`

### `validateTags(tags)`

```ts
function validateTags(tags: string[]): { ok: true; tags: string[] } | { ok: false; error: string }
```

Validate and deduplicate a tags array. Tags must be lowercase alphanumeric + hyphens, 1-32 chars each, max 20 tags.

| Parameter | Type | Description |
|-----------|------|-------------|
| `tags` | `string[]` | Array of tag strings to validate |

**Source:** `packages/core/src/validation.ts`

```ts
import { validateTags } from "@mecha/core";

validateTags(["research", "data"]);  // { ok: true, tags: ["research", "data"] }
validateTags(["UPPER!"]);            // { ok: false, error: "..." }
```

### `validateCapabilities(caps)`

```ts
function validateCapabilities(caps: string[]): { ok: true; capabilities: Capability[] } | { ok: false; error: string }
```

Validate a list of capability strings against the known `Capability` enum values.

| Parameter | Type | Description |
|-----------|------|-------------|
| `caps` | `string[]` | Array of capability strings to validate |

**Source:** `packages/core/src/validation.ts`

```ts
import { validateCapabilities } from "@mecha/core";

validateCapabilities(["query", "execute"]);  // { ok: true, capabilities: [...] }
validateCapabilities(["invalid"]);           // { ok: false, error: 'Invalid capability: "invalid"' }
```

### `parsePort(input)`

```ts
function parsePort(raw: string): number | undefined
```

Parse a port string to a valid port number (1-65535). Returns `undefined` for invalid input. Rejects hex (`0x1f90`), scientific notation (`1e3`), and non-decimal formats.

| Parameter | Type | Description |
|-----------|------|-------------|
| `raw` | `string` | The port string to parse |

**Source:** `packages/core/src/validation.ts`

```ts
import { parsePort } from "@mecha/core";

parsePort("7660");   // 7660
parsePort("0");      // undefined (out of range)
parsePort("0x1f90"); // undefined (non-decimal)
```

## Identity

**Source:** `packages/core/src/identity/`

Cryptographic identity management for nodes and bots. Ed25519 keys for signing, X25519 keys for Noise IK encryption.

### `KeyPair`

```ts
interface KeyPair {
  publicKey: string;   // PEM-encoded Ed25519 public key
  privateKey: string;  // PEM-encoded Ed25519 private key
}
```

### `NodeIdentity`

```ts
interface NodeIdentity {
  readonly id: string;
  readonly publicKey: string;
  readonly fingerprint: string;
  readonly createdAt: string;
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique node UUID |
| `publicKey` | `string` | PEM-encoded Ed25519 public key |
| `fingerprint` | `string` | 16-char hex SHA-256 fingerprint of the public key |
| `createdAt` | `string` | ISO 8601 timestamp |

### `BotIdentity`

```ts
interface BotIdentity {
  readonly name: string;
  readonly nodeId: string;
  readonly publicKey: string;
  readonly nodePublicKey: string;
  readonly fingerprint: string;
  readonly signature: string;
  readonly createdAt: string;
}
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Bot name |
| `nodeId` | `string` | Parent node UUID |
| `publicKey` | `string` | PEM-encoded Ed25519 public key |
| `nodePublicKey` | `string` | Node's public key (for verification) |
| `fingerprint` | `string` | 16-char hex SHA-256 fingerprint |
| `signature` | `string` | Base64 Ed25519 signature (node signs bot public key) |
| `createdAt` | `string` | ISO 8601 timestamp |

### `NoiseKeyPair`

```ts
interface NoiseKeyPair {
  publicKey: string;   // base64url-encoded X25519 public DER
  privateKey: string;  // base64url-encoded X25519 private DER
}
```

### `generateKeyPair()`

```ts
function generateKeyPair(): KeyPair
```

Generate a new Ed25519 keypair. Returns PEM-encoded public and private keys.

**Source:** `packages/core/src/identity/keys.ts`

```ts
import { generateKeyPair } from "@mecha/core";

const kp = generateKeyPair();
console.log(kp.publicKey);  // "-----BEGIN PUBLIC KEY-----\n..."
```

### `fingerprint(publicKeyPem)`

```ts
function fingerprint(publicKeyPem: string): string
```

Compute a SHA-256 fingerprint from a PEM public key, returned as a 16-character hex string.

| Parameter | Type | Description |
|-----------|------|-------------|
| `publicKeyPem` | `string` | PEM-encoded public key |

**Source:** `packages/core/src/identity/keys.ts`

### `loadPrivateKey(keyPath)`

```ts
function loadPrivateKey(keyPath: string): string
```

Load a PEM private key from a file path.

| Parameter | Type | Description |
|-----------|------|-------------|
| `keyPath` | `string` | Absolute path to the PEM key file |

**Source:** `packages/core/src/identity/keys.ts`

### `createNodeIdentity(mechaDir)`

```ts
function createNodeIdentity(mechaDir: string): NodeIdentity
```

Create a node identity with a new Ed25519 keypair. Writes `node.json` and `node.key` to `mechaDir/identity/`. Idempotent: returns the existing identity if already present. Also generates X25519 noise keys for P2P encryption.

| Parameter | Type | Description |
|-----------|------|-------------|
| `mechaDir` | `string` | Path to the `.mecha` directory |

**Source:** `packages/core/src/identity/node-identity.ts`

```ts
import { createNodeIdentity } from "@mecha/core";

const identity = createNodeIdentity("/home/alice/.mecha");
console.log(identity.fingerprint); // "a1b2c3d4e5f67890"
```

### `loadNodeIdentity(mechaDir)`

```ts
function loadNodeIdentity(mechaDir: string): NodeIdentity | undefined
```

Load an existing node identity from `mechaDir/identity/node.json`. Returns `undefined` if the file does not exist.

| Parameter | Type | Description |
|-----------|------|-------------|
| `mechaDir` | `string` | Path to the `.mecha` directory |

**Source:** `packages/core/src/identity/node-identity.ts`

### `createBotIdentity(botDir, name, nodeIdentity, nodePrivateKeyPem)`

```ts
function createBotIdentity(
  botDir: string,
  name: BotName,
  nodeIdentity: NodeIdentity,
  nodePrivateKeyPem: string,
): BotIdentity
```

Create a bot identity with an Ed25519 keypair, signed by the node's private key to prove provenance. Writes `identity.json` and `bot.key` to the bot directory. Idempotent.

| Parameter | Type | Description |
|-----------|------|-------------|
| `botDir` | `string` | Path to the bot directory |
| `name` | `BotName` | Validated bot name |
| `nodeIdentity` | `NodeIdentity` | Parent node identity |
| `nodePrivateKeyPem` | `string` | Node's PEM-encoded private key for signing |

**Source:** `packages/core/src/identity/bot-identity.ts`

### `loadBotIdentity(mechaDir, name)`

```ts
function loadBotIdentity(mechaDir: string, name: BotName): BotIdentity | undefined
```

Load a bot identity by name from the mecha directory. Returns `undefined` if missing. Includes path traversal protection.

| Parameter | Type | Description |
|-----------|------|-------------|
| `mechaDir` | `string` | Path to the `.mecha` directory |
| `name` | `BotName` | Validated bot name |

**Source:** `packages/core/src/identity/bot-identity.ts`

### `loadBotIdentityFromDir(botDir)`

```ts
function loadBotIdentityFromDir(botDir: string): BotIdentity | undefined
```

Load a bot identity directly from a bot directory by reading `identity.json`. Returns `undefined` if the file is missing or malformed.

| Parameter | Type | Description |
|-----------|------|-------------|
| `botDir` | `string` | Path to the bot directory |

**Source:** `packages/core/src/identity/bot-identity.ts`

```ts
import { loadBotIdentityFromDir } from "@mecha/core";

const identity = loadBotIdentityFromDir("/home/alice/.mecha/researcher");
if (identity) {
  console.log(`Bot ${identity.name}, fingerprint: ${identity.fingerprint}`);
}
```

### `loadNodePrivateKey(mechaDir)`

```ts
function loadNodePrivateKey(mechaDir: string): string | undefined
```

Load the node's PEM-encoded Ed25519 private key from `mechaDir/identity/node.key`. Returns `undefined` if the file is missing or unreadable.

| Parameter | Type | Description |
|-----------|------|-------------|
| `mechaDir` | `string` | Path to the `.mecha` directory |

**Source:** `packages/core/src/identity/node-identity.ts`

```ts
import { loadNodePrivateKey } from "@mecha/core";

const pem = loadNodePrivateKey("/home/alice/.mecha");
if (pem) {
  console.log("Node private key loaded");
}
```

### `loadNoisePublicKey(mechaDir)`

```ts
function loadNoisePublicKey(mechaDir: string): string | undefined
```

Load only the X25519 noise public key from `mechaDir/identity/noise.pub`. Returns `undefined` if the file is missing or empty.

| Parameter | Type | Description |
|-----------|------|-------------|
| `mechaDir` | `string` | Path to the `.mecha` directory |

**Source:** `packages/core/src/identity/noise-keys.ts`

```ts
import { loadNoisePublicKey } from "@mecha/core";

const noiseKey = loadNoisePublicKey("/home/alice/.mecha");
if (noiseKey) {
  console.log(`Noise public key: ${noiseKey}`);
}
```

### `signMessage(privateKeyPem, data)`

```ts
function signMessage(privateKeyPem: string, data: Uint8Array): string
```

Sign data with a PEM-encoded Ed25519 private key. Returns a base64-encoded signature.

| Parameter | Type | Description |
|-----------|------|-------------|
| `privateKeyPem` | `string` | PEM-encoded Ed25519 private key |
| `data` | `Uint8Array` | Data to sign |

**Source:** `packages/core/src/identity/signing.ts`

```ts
import { signMessage } from "@mecha/core";

const sig = signMessage(privateKeyPem, new TextEncoder().encode("hello"));
```

### `verifySignature(publicKeyPem, data, signatureBase64)`

```ts
function verifySignature(publicKeyPem: string, data: Uint8Array, signatureBase64: string): boolean
```

Verify a base64 signature against a PEM-encoded Ed25519 public key. Returns `false` on malformed keys or signatures (never throws).

| Parameter | Type | Description |
|-----------|------|-------------|
| `publicKeyPem` | `string` | PEM-encoded Ed25519 public key |
| `data` | `Uint8Array` | Original data that was signed |
| `signatureBase64` | `string` | Base64-encoded signature to verify |

**Source:** `packages/core/src/identity/signing.ts`

### `generateNoiseKeyPair()`

```ts
function generateNoiseKeyPair(): NoiseKeyPair
```

Generate a new X25519 keypair for Noise IK Diffie-Hellman. Returns base64url-encoded DER keys.

**Source:** `packages/core/src/identity/noise-keys.ts`

### `createNoiseKeys(mechaDir)`

```ts
function createNoiseKeys(mechaDir: string): NoiseKeyPair
```

Create and persist X25519 noise keys to `mechaDir/identity/noise.pub` and `noise.key`. Idempotent: returns existing keys if already present.

| Parameter | Type | Description |
|-----------|------|-------------|
| `mechaDir` | `string` | Path to the `.mecha` directory |

**Source:** `packages/core/src/identity/noise-keys.ts`

### `loadNoiseKeyPair(mechaDir)`

```ts
function loadNoiseKeyPair(mechaDir: string): NoiseKeyPair | undefined
```

Load an existing X25519 noise keypair from `mechaDir/identity/`. Returns `undefined` if missing.

| Parameter | Type | Description |
|-----------|------|-------------|
| `mechaDir` | `string` | Path to the `.mecha` directory |

**Source:** `packages/core/src/identity/noise-keys.ts`

## Auth Resolution

**Source:** `packages/core/src/auth-resolve.ts`

Resolve authentication credentials for bots from the profile/credential store.

### `AuthProfileMeta`

```ts
interface AuthProfileMeta {
  name: string;
  type: "oauth" | "api-key";
  account: string | null;
  label: string;
  tags: string[];
  expiresAt: number | null;
  createdAt: string;
}
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Profile name |
| `type` | `"oauth" \| "api-key"` | Authentication type |
| `account` | `string \| null` | Associated account identifier |
| `label` | `string` | Human-readable label |
| `tags` | `string[]` | Profile tags |
| `expiresAt` | `number \| null` | Token expiration timestamp (ms since epoch), or `null` for no expiry |
| `createdAt` | `string` | ISO 8601 creation timestamp |

### `AuthProfileStore`

```ts
interface AuthProfileStore {
  default: string | null;
  profiles: Record<string, Omit<AuthProfileMeta, "name">>;
}
```

Stored format of `auth/profiles.json`.

### `ResolvedAuth`

```ts
interface ResolvedAuth {
  profileName: string;
  type: "oauth" | "api-key";
  envVar: "CLAUDE_CODE_OAUTH_TOKEN" | "ANTHROPIC_API_KEY";
  token: string;
}
```

| Field | Type | Description |
|-------|------|-------------|
| `profileName` | `string` | Name of the resolved profile |
| `type` | `"oauth" \| "api-key"` | Authentication type |
| `envVar` | `string` | Environment variable to set for the SDK |
| `token` | `string` | The resolved authentication token |

### `resolveAuth(mechaDir, profile?)`

```ts
function resolveAuth(mechaDir: string, authProfileName?: string | null): ResolvedAuth | null
```

Resolve auth credentials for a bot. Resolution chain: (1) explicit profile name, (2) default profile, (3) error. Returns `null` when `authProfileName` is explicitly `null` (opt-out). Supports `$env:api-key` and `$env:oauth` sentinel profiles that read directly from environment variables.

| Parameter | Type | Description |
|-----------|------|-------------|
| `mechaDir` | `string` | Path to the `.mecha` directory |
| `authProfileName` | `string \| null?` | Explicit profile name, `null` for no auth, or `undefined` for default |

**Throws:** `AuthProfileNotFoundError`, `AuthTokenInvalidError`

**Source:** `packages/core/src/auth-resolve.ts`

```ts
import { resolveAuth } from "@mecha/core";

const auth = resolveAuth("/home/alice/.mecha", "my-profile");
if (auth) {
  console.log(`Using ${auth.type} via ${auth.envVar}`);
}
```

### `readAuthProfiles(mechaDir)`

```ts
function readAuthProfiles(mechaDir: string): AuthProfileStore
```

Read `auth/profiles.json`. Returns an empty store (`{ default: null, profiles: {} }`) if the file is missing or corrupt.

| Parameter | Type | Description |
|-----------|------|-------------|
| `mechaDir` | `string` | Path to the `.mecha` directory |

**Source:** `packages/core/src/auth-resolve.ts`

### `readAuthCredentials(mechaDir)`

```ts
function readAuthCredentials(mechaDir: string): AuthCredentialStore
```

Read `auth/credentials.json`. Returns an empty object if the file is missing or corrupt.

| Parameter | Type | Description |
|-----------|------|-------------|
| `mechaDir` | `string` | Path to the `.mecha` directory |

**Source:** `packages/core/src/auth-resolve.ts`

### `listAuthProfiles(mechaDir)`

```ts
function listAuthProfiles(mechaDir: string): AuthProfileMeta[]
```

List all profiles with metadata (no tokens included).

| Parameter | Type | Description |
|-----------|------|-------------|
| `mechaDir` | `string` | Path to the `.mecha` directory |

**Source:** `packages/core/src/auth-resolve.ts`

### `getDefaultProfileName(mechaDir)`

```ts
function getDefaultProfileName(mechaDir: string): string | null
```

Get the default profile name, or `null` if no default is set.

| Parameter | Type | Description |
|-----------|------|-------------|
| `mechaDir` | `string` | Path to the `.mecha` directory |

**Source:** `packages/core/src/auth-resolve.ts`

### `isValidProfileName(name)`

```ts
function isValidProfileName(name: string): boolean
```

Validate a profile name: lowercase alphanumeric + hyphens, max 64 chars, no reserved keys (`__proto__`, `constructor`, etc.).

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | The profile name to validate |

**Source:** `packages/core/src/auth-resolve.ts`

### `authEnvVar(type)`

```ts
function authEnvVar(type: "oauth" | "api-key"): "CLAUDE_CODE_OAUTH_TOKEN" | "ANTHROPIC_API_KEY"
```

Map a profile type to the correct SDK environment variable name.

| Parameter | Type | Description |
|-----------|------|-------------|
| `type` | `"oauth" \| "api-key"` | Authentication type |

**Source:** `packages/core/src/auth-resolve.ts`

## Node Registry

**Source:** `packages/core/src/node-registry.ts`

Manage the manually-added peer node registry (`nodes.json`). For auto-discovered nodes, see [Discovered Node Registry](#discovered-node-registry).

### `NodeEntry`

```ts
interface NodeEntry {
  name: string;
  host: string;
  port: number;
  apiKey: string;
  publicKey?: string;
  noisePublicKey?: string;
  fingerprint?: string;
  addedAt: string;
  managed?: boolean;
  serverUrl?: string;
}
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Node name (unique identifier) |
| `host` | `string` | IP address or hostname |
| `port` | `number` | Agent server port |
| `apiKey` | `string` | API key for authentication |
| `publicKey` | `string?` | PEM-encoded Ed25519 public key |
| `noisePublicKey` | `string?` | Base64url-encoded X25519 noise public key |
| `fingerprint` | `string?` | 16-char hex fingerprint (required if `managed` is `true`) |
| `addedAt` | `string` | ISO 8601 timestamp |
| `managed` | `boolean?` | Whether this node is managed (requires `publicKey` and `fingerprint`) |
| `serverUrl` | `string?` | Optional server URL override |

### `readNodes(mechaDir)`

```ts
function readNodes(mechaDir: string): NodeEntry[]
```

Read all registered peer nodes from `nodes.json`. Returns an empty array if the file does not exist.

| Parameter | Type | Description |
|-----------|------|-------------|
| `mechaDir` | `string` | Path to the `.mecha` directory |

**Throws:** `CorruptConfigError` if the file exists but contains invalid data.

**Source:** `packages/core/src/node-registry.ts`

```ts
import { readNodes } from "@mecha/core";

const nodes = readNodes("/home/alice/.mecha");
for (const node of nodes) {
  console.log(`${node.name} at ${node.host}:${node.port}`);
}
```

### `writeNodes(mechaDir, nodes)`

```ts
function writeNodes(mechaDir: string, nodes: NodeEntry[]): void
```

Write the nodes array to `nodes.json` (atomic: temp file + rename).

| Parameter | Type | Description |
|-----------|------|-------------|
| `mechaDir` | `string` | Path to the `.mecha` directory |
| `nodes` | `NodeEntry[]` | Array of node entries to write |

**Source:** `packages/core/src/node-registry.ts`

### `addNode(mechaDir, entry)`

```ts
function addNode(mechaDir: string, entry: NodeEntry): void
```

Add a peer node to the registry.

| Parameter | Type | Description |
|-----------|------|-------------|
| `mechaDir` | `string` | Path to the `.mecha` directory |
| `entry` | `NodeEntry` | The node entry to add |

**Throws:** `InvalidNameError` if the name is invalid, `DuplicateNodeError` if the name already exists.

**Source:** `packages/core/src/node-registry.ts`

### `removeNode(mechaDir, name)`

```ts
function removeNode(mechaDir: string, name: string): boolean
```

Remove a peer node by name. Returns `false` if the node was not found.

| Parameter | Type | Description |
|-----------|------|-------------|
| `mechaDir` | `string` | Path to the `.mecha` directory |
| `name` | `string` | Name of the node to remove |

**Throws:** `InvalidNameError` if the name is invalid.

**Source:** `packages/core/src/node-registry.ts`

### `getNode(mechaDir, name)`

```ts
function getNode(mechaDir: string, name: string): NodeEntry | undefined
```

Get a single peer node by name. Returns `undefined` if not found.

| Parameter | Type | Description |
|-----------|------|-------------|
| `mechaDir` | `string` | Path to the `.mecha` directory |
| `name` | `string` | Name of the node to look up |

**Throws:** `InvalidNameError` if the name is invalid.

**Source:** `packages/core/src/node-registry.ts`

## Bot Config

**Source:** `packages/core/src/bot-config.ts`

Read and update per-bot configuration files (`config.json` inside each bot directory).

### `SandboxMode`

```ts
type SandboxMode = "auto" | "off" | "require";
```

Sandbox enforcement mode: `"auto"` (use if available), `"off"` (disable), `"require"` (fail if unavailable).

### `BotConfig`

```ts
interface BotConfig {
  configVersion?: number;
  port: number;
  token: string;
  workspace: string;
  home?: string;
  model?: string;
  permissionMode?: string;
  auth?: string;
  tags?: string[];
  expose?: string[];
  sandboxMode?: SandboxMode;
  allowNetwork?: boolean;
}
```

| Field | Type | Description |
|-------|------|-------------|
| `configVersion` | `number?` | Schema version for forward-compatible reads |
| `port` | `number` | Bot's assigned port |
| `token` | `string` | Authentication token |
| `workspace` | `string` | Workspace directory path |
| `home` | `string?` | Custom HOME directory (defaults to bot directory) |
| `model` | `string?` | Claude model override |
| `permissionMode` | `string?` | Permission mode for the Claude SDK |
| `auth` | `string?` | Auth profile name |
| `tags` | `string[]?` | Discovery tags |
| `expose` | `string[]?` | Exposed capabilities |
| `sandboxMode` | `SandboxMode?` | Sandbox enforcement mode |
| `allowNetwork` | `boolean?` | Whether network access is permitted in sandbox |

### `readBotConfig(botDir)`

```ts
function readBotConfig(botDir: string): BotConfig | undefined
```

Read a bot's `config.json`. Returns `undefined` if the file is missing or malformed.

| Parameter | Type | Description |
|-----------|------|-------------|
| `botDir` | `string` | Path to the bot directory |

**Source:** `packages/core/src/bot-config.ts`

```ts
import { readBotConfig } from "@mecha/core";

const config = readBotConfig("/home/alice/.mecha/researcher");
if (config) {
  console.log(`Port: ${config.port}, Workspace: ${config.workspace}`);
}
```

### `updateBotConfig(botDir, updates, fallback?)`

```ts
function updateBotConfig(botDir: string, updates: Partial<BotConfig>, fallback?: BotConfig): void
```

Update fields in a bot's `config.json` using read-modify-write with atomic file write. When the existing config is corrupt or missing, uses `fallback` as the base if provided.

| Parameter | Type | Description |
|-----------|------|-------------|
| `botDir` | `string` | Path to the bot directory |
| `updates` | `Partial<BotConfig>` | Fields to update |
| `fallback` | `BotConfig?` | Base config to use if existing config is missing |

**Throws:** `Error` if no valid config exists and no fallback is provided.

**Source:** `packages/core/src/bot-config.ts`

```ts
import { updateBotConfig } from "@mecha/core";

updateBotConfig("/home/alice/.mecha/researcher", { tags: ["research", "data"] });
```

### `BOT_CONFIG_VERSION`

```ts
const BOT_CONFIG_VERSION: number
```

Current schema version number written to `config.json` when creating or updating bot configs.

### `BotConfigValidationInput`

```ts
interface BotConfigValidationInput {
  permissionMode?: string;
  sandboxMode?: string;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  tools?: string[];
  maxBudgetUsd?: number;
  meterOff?: boolean;
}
```

Input to `validateBotConfig`. Contains the subset of bot config fields subject to cross-field validation rules.

### `BotConfigValidationResult`

```ts
interface BotConfigValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}
```

| Field | Type | Description |
|-------|------|-------------|
| `ok` | `boolean` | `true` if no errors were found (warnings are allowed) |
| `errors` | `string[]` | Validation errors that prevent saving |
| `warnings` | `string[]` | Non-blocking warnings about potentially unsafe combinations |

### `validateBotConfig(input): BotConfigValidationResult`

Validate cross-field constraints on bot configuration. Returns errors and warnings without throwing. Use this before saving config changes to catch mutually exclusive or unsafe field combinations.

```ts
import { validateBotConfig } from "@mecha/core";

const result = validateBotConfig({
  permissionMode: "bypassPermissions",
  sandboxMode: "off",
  systemPrompt: "You are a researcher.",
  appendSystemPrompt: "Always cite sources.",
});

if (!result.ok) {
  console.error("Config errors:", result.errors);
  // ["permissionMode 'bypassPermissions' requires sandboxMode 'require'",
  //  "systemPrompt and appendSystemPrompt are mutually exclusive"]
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `input` | `BotConfigValidationInput` | Yes | Config fields to validate |

**Source:** `packages/core/src/bot-config-validation.ts`

**Validation rules:**

| Rule | Severity | Condition |
|------|----------|-----------|
| `permissionMode 'bypassPermissions' requires sandboxMode 'require'` | Error | `permissionMode` is `"bypassPermissions"` but `sandboxMode` is not `"require"` |
| `systemPrompt and appendSystemPrompt are mutually exclusive` | Error | Both `systemPrompt` and `appendSystemPrompt` are set |
| `allowedTools and tools are mutually exclusive` | Error | Both `allowedTools` and `tools` are non-empty |
| `disallowedTools and tools are mutually exclusive` | Error | Both `disallowedTools` and `tools` are non-empty |
| `permissionMode 'auto' with sandboxMode 'off' has no safety net` | Warning | `permissionMode` is `"auto"` and `sandboxMode` is `"off"` |
| `maxBudgetUsd set but metering is off` | Warning | `maxBudgetUsd` is set and `meterOff` is `true` |

## Server State

**Source:** `packages/core/src/server-state.ts`

Track the embedded server's runtime state in `server.json`.

### `ServerState`

```ts
interface ServerState {
  port: number;
  host: string;
  publicAddr?: string;
  startedAt: string;
}
```

| Field | Type | Description |
|-------|------|-------------|
| `port` | `number` | Server port |
| `host` | `string` | Bind address |
| `publicAddr` | `string?` | Optional public address |
| `startedAt` | `string` | ISO 8601 start timestamp |

### `readServerState(mechaDir)`

```ts
function readServerState(mechaDir: string): ServerState | undefined
```

Read the embedded server state. Returns `undefined` if the server is not running (file absent or corrupt).

| Parameter | Type | Description |
|-----------|------|-------------|
| `mechaDir` | `string` | Path to the `.mecha` directory |

**Source:** `packages/core/src/server-state.ts`

```ts
import { readServerState } from "@mecha/core";

const state = readServerState("/home/alice/.mecha");
if (state) {
  console.log(`Server running on ${state.host}:${state.port}`);
}
```

### `writeServerState(mechaDir, state)`

```ts
function writeServerState(mechaDir: string, state: ServerState): void
```

Write server state to disk (atomic: temp + rename, mode `0o600`).

| Parameter | Type | Description |
|-----------|------|-------------|
| `mechaDir` | `string` | Path to the `.mecha` directory |
| `state` | `ServerState` | Server state to persist |

**Source:** `packages/core/src/server-state.ts`

### `removeServerState(mechaDir)`

```ts
function removeServerState(mechaDir: string): void
```

Remove the server state file. Safe to call if the file does not exist.

| Parameter | Type | Description |
|-----------|------|-------------|
| `mechaDir` | `string` | Path to the `.mecha` directory |

**Source:** `packages/core/src/server-state.ts`

## TOTP Storage

**Source:** `packages/core/src/totp-storage.ts`

Read, write, and generate TOTP secrets for dashboard authentication.

### `readTotpSecret(mechaDir)`

```ts
function readTotpSecret(mechaDir: string): string | null
```

Read the TOTP secret from the `totp-secret` file. Falls back to the `MECHA_OTP` environment variable if the file does not exist. Returns `null` if neither source provides a secret.

| Parameter | Type | Description |
|-----------|------|-------------|
| `mechaDir` | `string` | Path to the `.mecha` directory |

**Source:** `packages/core/src/totp-storage.ts`

```ts
import { readTotpSecret } from "@mecha/core";

const secret = readTotpSecret("/home/alice/.mecha");
if (secret) {
  console.log("TOTP secret loaded");
}
```

### `writeTotpSecret(mechaDir, secret)`

```ts
function writeTotpSecret(mechaDir: string, secret: string): void
```

Write a TOTP secret to the `totp-secret` file with mode `0o600` using atomic temp + rename.

| Parameter | Type | Description |
|-----------|------|-------------|
| `mechaDir` | `string` | Path to the `.mecha` directory |
| `secret` | `string` | Base32-encoded TOTP secret |

**Source:** `packages/core/src/totp-storage.ts`

### `generateTotpSecret()`

```ts
function generateTotpSecret(): Promise<string>
```

Generate a new base32-encoded TOTP secret (20-byte key). Dynamically imports `otpauth` at runtime.

**Source:** `packages/core/src/totp-storage.ts`

### `ensureTotpSecret(mechaDir)`

```ts
function ensureTotpSecret(mechaDir: string): Promise<{ secret: string; isNew: boolean }>
```

Read existing TOTP secret or generate and store a new one. Returns `{ isNew: true }` if a new secret was created.

| Parameter | Type | Description |
|-----------|------|-------------|
| `mechaDir` | `string` | Path to the `.mecha` directory |

**Source:** `packages/core/src/totp-storage.ts`

```ts
import { ensureTotpSecret } from "@mecha/core";

const { secret, isNew } = await ensureTotpSecret("/home/alice/.mecha");
if (isNew) {
  console.log("New TOTP secret generated — scan QR code to set up authenticator");
}
```

## Forwarding

**Source:** `packages/core/src/forwarding.ts`

HTTP forwarding utility for inter-bot communication. Used by the service layer and mesh tools to send queries between bots via their local HTTP API.

### `ForwardResult`

```ts
interface ForwardResult {
  text: string;
  sessionId?: string;
}
```

| Field | Type | Description |
|-------|------|-------------|
| `text` | `string` | Response text from the target bot |
| `sessionId` | `string?` | Session ID returned by the target bot (if the response was JSON) |

### `forwardQueryToBot(port, token, message, sessionId?, requestId?): Promise<ForwardResult>`

Forward a query message to a bot via HTTP POST to `http://127.0.0.1:{port}/api/chat`. Shared by the service router and runtime mesh tools for inter-bot communication.

The request is sent with a 60-second timeout (`DEFAULTS.FORWARD_TIMEOUT_MS`). If the response is JSON, the `response` and `sessionId` fields are extracted; otherwise the raw text body is returned.

```ts
import { forwardQueryToBot } from "@mecha/core";

const result = await forwardQueryToBot(
  7701,                          // target bot port
  "bot-auth-token",              // target bot token
  "Summarize the latest report", // message to send
  "session-abc-123",             // optional: reuse existing session
);
console.log(result.text);       // bot's response
console.log(result.sessionId);  // session ID for follow-up queries
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `port` | `number` | Yes | Target bot's port number |
| `token` | `string` | Yes | Target bot's auth token (sent as `Bearer` header) |
| `message` | `string` | Yes | Query message to send |
| `sessionId` | `string` | No | Session ID for continuing an existing conversation |
| `requestId` | `string` | No | Request ID forwarded as `x-request-id` header for tracing |

**Throws:** `ForwardingError` with the HTTP status code if the request fails or the target returns a non-2xx response. A status of `0` indicates a network-level failure (connection refused, timeout, etc.).

**Source:** `packages/core/src/forwarding.ts`

## Process Utilities

### `isPidAlive(pid): boolean`

Check if a process with the given PID is alive using `kill -0`. Returns `true` if the process exists (even if owned by another user), `false` if it doesn't.

```ts
import { isPidAlive } from "@mecha/core";

isPidAlive(12345); // true if process exists
isPidAlive(-1);    // false (invalid PID)
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pid` | `number` | Yes | Process ID to check (must be a positive integer) |

**Source:** `packages/core/src/pid.ts`

### `safeCompare(a, b): boolean`

Constant-time string comparison to prevent timing side-channel attacks. Used for bearer token validation across all servers. Rejects tokens longer than 4096 bytes.

```ts
import { safeCompare } from "@mecha/core";

safeCompare(request.token, expected); // true/false without timing leakage
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `a` | `string` | Yes | First string |
| `b` | `string` | Yes | Second string |

**Source:** `packages/core/src/safe-compare.ts`

## Address Type Guards

### `isBotAddress(addr): boolean`

Type guard that narrows an `Address` to `BotAddress`. Returns `true` if the address has `bot` and `node` fields.

```ts
import { isBotAddress, parseAddress } from "@mecha/core";

const addr = parseAddress("coder@alice");
if (isBotAddress(addr)) {
  console.log(addr.bot, addr.node); // "coder", "alice"
}
```

### `isGroupAddress(addr): boolean`

Type guard that narrows an `Address` to `GroupAddress`. Returns `true` if the address has a `group` field.

```ts
import { isGroupAddress, parseAddress } from "@mecha/core";

const addr = parseAddress("@devteam");
if (isGroupAddress(addr)) {
  console.log(addr.group); // "devteam"
}
```

## ACL Engine Options

### `CreateAclEngineOpts`

Options passed to `createAclEngine()`.

```ts
interface CreateAclEngineOpts {
  mechaDir: string;
  /** Override for reading expose config — used in tests. */
  getExpose?: (name: string) => Capability[];
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `mechaDir` | `string` | Yes | Path to the Mecha data directory |
| `getExpose` | `(name: string) => Capability[]` | No | Custom function to read bot expose config. Defaults to reading from bot `config.json`. |

## See also

- [Error Reference](/reference/errors) — Error classes and codes
- [@mecha/connect](/reference/api/connect) — P2P connectivity types that depend on core identity types
- [@mecha/process](/reference/api/process) — Process management that uses core schemas
- [API Reference](/reference/api/) — Route summary and package overview
