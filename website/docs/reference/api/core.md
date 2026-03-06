---
title: "@mecha/core"
description: API reference for @mecha/core — types, schemas, validation, ACL engine, identity, logging, discovery, and shared utilities.
---

# @mecha/core

Shared utility functions, types, and schemas re-exported from the `@mecha/core` barrel.

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

### `RESERVED_PLUGIN_NAMES`

Plugin names cannot collide with built-in capabilities (`query`, `read_workspace`, etc.) or internal names (`mecha`, `__proto__`, `constructor`).

## See also

- [Error Reference](/reference/errors) — Error classes and codes
- [@mecha/connect](/reference/api/connect) — P2P connectivity types that depend on core identity types
- [@mecha/process](/reference/api/process) — Process management that uses core schemas
- [API Reference](/reference/api/) — Route summary and package overview
