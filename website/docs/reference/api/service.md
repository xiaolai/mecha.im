---
title: "@mecha/service"
description: API reference for @mecha/service — high-level business logic layer for bot operations, routing, auth, scheduling, and node management.
---

# @mecha/service

[[toc]]

The `@mecha/service` package is the high-level business logic layer that CLI commands and dashboard routes call into. It orchestrates `@mecha/process`, `@mecha/core`, and `@mecha/meter`.

## Barrel Exports

| Export | Kind | Source |
|--------|------|--------|
| `resolveBotEndpoint` | Function | `helpers.ts` |
| `runtimeFetch` | Function | `helpers.ts` |
| `assertOk` | Function | `helpers.ts` |
| `RuntimeFetchOpts` | Type | `helpers.ts` |
| `RuntimeFetchResult` | Type | `helpers.ts` |
| `botStatus` | Function | `bot.ts` |
| `botFind` | Function | `bot.ts` |
| `botConfigure` | Function | `bot.ts` |
| `FindResult` | Type | `bot.ts` |
| `BotConfigUpdates` | Type | `bot.ts` |
| `botChat` | Function | `chat.ts` |
| `ChatOpts` | Type | `chat.ts` |
| `ChatResult` | Type | `chat.ts` |
| `botSessionList` | Function | `sessions.ts` |
| `botSessionGet` | Function | `sessions.ts` |
| `botSessionDelete` | Function | `sessions.ts` |
| `mechaInit` | Function | `init.ts` |
| `InitResult` | Type | `init.ts` |
| `mechaDoctor` | Function | `doctor.ts` |
| `DoctorCheck` | Type | `doctor.ts` |
| `DoctorResult` | Type | `doctor.ts` |
| `mechaToolInstall` | Function | `tools.ts` |
| `mechaToolLs` | Function | `tools.ts` |
| `mechaToolRemove` | Function | `tools.ts` |
| `ToolInfo` | Type | `tools.ts` |
| `ToolInstallOpts` | Type | `tools.ts` |
| `mechaAuthAdd` | Function | `auth.ts` |
| `mechaAuthAddFull` | Function | `auth.ts` |
| `mechaAuthLs` | Function | `auth.ts` |
| `mechaAuthDefault` | Function | `auth.ts` |
| `mechaAuthRm` | Function | `auth.ts` |
| `mechaAuthTag` | Function | `auth.ts` |
| `mechaAuthSwitch` | Function | `auth.ts` |
| `mechaAuthTest` | Function | `auth.ts` |
| `mechaAuthRenew` | Function | `auth.ts` |
| `mechaAuthGet` | Function | `auth.ts` |
| `mechaAuthGetDefault` | Function | `auth.ts` |
| `mechaAuthSwitchBot` | Function | `auth.ts` |
| `mechaAuthProbe` | Function | `auth-probe.ts` |
| `AuthProfile` | Type | `auth.ts` |
| `AuthAddOpts` | Type | `auth.ts` |
| `buildHierarchy` | Function | `hierarchy.ts` |
| `flattenHierarchy` | Function | `hierarchy.ts` |
| `HierarchyNode` | Type | `hierarchy.ts` |
| `createBotRouter` | Function | `router.ts` |
| `BotRouter` | Type | `router.ts` |
| `CreateRouterOpts` | Type | `router.ts` |
| `nodeInit` | Function | `node-init.ts` |
| `readNodeName` | Function | `node-init.ts` |
| `NodeInitResult` | Type | `node-init.ts` |
| `agentFetch` | Function | `agent-fetch.ts` |
| `AgentFetchOpts` | Type | `agent-fetch.ts` |
| `SecureChannelLike` | Type | `agent-fetch.ts` |
| `createLocator` | Function | `locator.ts` |
| `MechaLocator` | Type | `locator.ts` |
| `LocateResult` | Type | `locator.ts` |
| `CreateLocatorOpts` | Type | `locator.ts` |
| `checkBotBusy` | Function | `task-check.ts` |
| `TaskCheckResult` | Type | `task-check.ts` |
| `batchBotAction` | Function | `bot-batch.ts` |
| `BatchActionOpts` | Type | `bot-batch.ts` |
| `BatchItemResult` | Type | `bot-batch.ts` |
| `BatchResult` | Type | `bot-batch.ts` |
| `enrichBotInfo` | Function | `bot-enrich.ts` |
| `buildEnrichContext` | Function | `bot-enrich.ts` |
| `EnrichedBotInfo` | Type | `bot-enrich.ts` |
| `EnrichContext` | Type | `bot-enrich.ts` |
| `getCachedSnapshot` | Function | `snapshot-cache.ts` |
| `invalidateSnapshotCache` | Function | `snapshot-cache.ts` |
| `botScheduleAdd` | Function | `schedule.ts` |
| `botScheduleRemove` | Function | `schedule.ts` |
| `botScheduleList` | Function | `schedule.ts` |
| `botSchedulePause` | Function | `schedule.ts` |
| `botScheduleResume` | Function | `schedule.ts` |
| `botScheduleRun` | Function | `schedule.ts` |
| `botScheduleHistory` | Function | `schedule.ts` |
| `nodePing` | Function | `node-ping.ts` |
| `PingResult` | Type | `node-ping.ts` |
| `resolveClaudeRuntime` | Function | `claude-runtime.ts` |
| `invalidateClaudeRuntimeCache` | Function | `claude-runtime.ts` |
| `ClaudeRuntimeInfo` | Type | `claude-runtime.ts` |
| `ResolvedFrom` | Type | `claude-runtime.ts` |
| `resolveBotHome` | Function | `bot-files.ts` |
| `readBotFile` | Function | `bot-files.ts` |
| `writeBotFile` | Function | `bot-files.ts` |
| `listBotDir` | Function | `bot-files.ts` |
| `FileNotFoundError` | Class | `bot-files.ts` |
| `NotMarkdownError` | Class | `bot-files.ts` |
| `FileTooLargeError` | Class | `bot-files.ts` |
| `DirEntry` | Type | `bot-files.ts` |
| `PathTraversalError` | Class | `bot-files.ts` (re-export from `@mecha/core`) |

## Bot Spawn Settings

When spawning a bot via `POST /bots` or updating config via `PATCH /bots/:name/config`, the following optional fields control LLM behavior, tool access, agent identity, MCP/plugins, and session settings. All fields are optional.

**LLM Behavior**

| Field | Type | Description |
|-------|------|-------------|
| `systemPrompt` | `string` | System prompt override (mutually exclusive with `appendSystemPrompt`) |
| `appendSystemPrompt` | `string` | Append to default system prompt (mutually exclusive with `systemPrompt`) |
| `effort` | `"low" \| "medium" \| "high"` | Effort level for the LLM |
| `maxBudgetUsd` | `number` | Max USD budget per session |

**Tool Control**

| Field | Type | Description |
|-------|------|-------------|
| `allowedTools` | `string[]` | Allowed tools (mutually exclusive with `tools`) |
| `disallowedTools` | `string[]` | Disallowed tools |
| `tools` | `string[]` | Override tool set (mutually exclusive with `allowedTools`) |

**Agent Identity & Environment**

| Field | Type | Description |
|-------|------|-------------|
| `agent` | `string` | Agent preset name |
| `addDirs` | `string[]` | Additional directories to mount |
| `budgetLimit` | `number` | Mecha-level aggregate budget cap |

**MCP & Plugins**

| Field | Type | Description |
|-------|------|-------------|
| `mcpConfigFiles` | `string[]` | MCP config file paths |
| `strictMcpConfig` | `boolean` | Only use specified MCP servers |
| `pluginDirs` | `string[]` | Plugin directories |

**Permissions & Fallback**

| Field | Type | Description |
|-------|------|-------------|
| `dangerouslySkipPermissions` | `boolean` | Skip all permission prompts (requires `sandboxMode: "require"`) |
| `allowDangerouslySkipPermissions` | `boolean` | Allow the bot to self-escalate to skip permissions |
| `fallbackModel` | `string` | Fallback model when primary is unavailable |

**Session Behavior**

| Field | Type | Description |
|-------|------|-------------|
| `sessionPersistence` | `boolean` | Enable/disable session persistence |
| `disableSlashCommands` | `boolean` | Disable all skills |

**Validation Rules:**
- `systemPrompt` and `appendSystemPrompt` are mutually exclusive
- `allowedTools` and `tools` are mutually exclusive
- `dangerouslySkipPermissions` requires `sandboxMode: "require"`

## `botStatus(pm, name)`

Returns the current status of a bot by name. Throws `BotNotFoundError` if the bot doesn't exist.

```ts
import { botStatus } from "@mecha/service";

const info = botStatus(pm, "researcher");
// { name: "researcher", state: "running", pid: 12345, port: 7700, ... }
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pm` | `ProcessManager` | Yes | Process manager instance |
| `name` | `BotName` | Yes | Bot name |

**Returns:** `ProcessInfo`

**Throws:** `BotNotFoundError` if the bot is not registered in the process manager.

## `botFind(mechaDir, pm, opts)`

Find bots matching optional tag filters, reading config for each.

```ts
import { botFind } from "@mecha/service";

const results = botFind("/Users/you/.mecha", pm, { tags: ["dev"] });
// [{ name: "coder", tags: ["dev", "backend"], state: "running", ... }]
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mechaDir` | `string` | Yes | Path to the Mecha data directory |
| `pm` | `ProcessManager` | Yes | Process manager instance |
| `opts` | `{ tags?: string[] }` | Yes | Filter options |

**`FindResult`** — `ProcessInfo` augmented with `tags: string[]`.

## `botChat(pm, name, opts, signal?)`

Send a chat message to a bot via its runtime `/api/chat` endpoint. Returns the assistant's response, session ID, duration, and cost.

```ts
import { botChat } from "@mecha/service";

const result = await botChat(pm, "coder", { message: "Explain this function" });
console.log(result.response);    // assistant's reply
console.log(result.sessionId);   // session ID for follow-up
console.log(result.costUsd);     // cost of this query
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pm` | `ProcessManager` | Yes | Process manager instance |
| `name` | `BotName` | Yes | Bot name |
| `opts` | `ChatOpts` | Yes | Chat options |
| `signal` | `AbortSignal` | No | Abort signal for cancellation |

**`ChatOpts`**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `message` | `string` | Yes | Message to send |
| `sessionId` | `string` | No | Session ID (creates new if omitted) |

**`ChatResult`**

| Field | Type | Description |
|-------|------|-------------|
| `response` | `string` | The assistant's reply |
| `sessionId` | `string` | Session ID (for multi-turn follow-up) |
| `durationMs` | `number` | Execution time in milliseconds |
| `costUsd` | `number` | Cost of this query in USD |

**Throws:** `ChatRequestError` if the bot's runtime returns a non-OK HTTP status.

## `mechaInit(mechaDir)`

Initialize Mecha data directory at `~/.mecha/`. Creates directory structure, generates node identity, and writes default configuration.

```ts
import { mechaInit } from "@mecha/service";

const result = mechaInit("/Users/you/.mecha");
// { created: true, mechaDir: "/Users/you/.mecha", nodeId: "abc-123", fingerprint: "SHA256:..." }
```

**`InitResult`** — `{ mechaDir: string, nodeId: string, fingerprint?: string, created: boolean }`

## `mechaDoctor(mechaDir)`

Run system health checks. Returns a list of checks with pass/fail status.

```ts
import { mechaDoctor } from "@mecha/service";

const result = mechaDoctor("/Users/you/.mecha");
for (const check of result.checks) {
  console.log(`${check.status === "ok" ? "✓" : "✗"} ${check.name}: ${check.message}`);
}
```

**`DoctorCheck`** — `{ name: string, status: "ok" | "warn" | "error", message: string }`

**`DoctorResult`** — `{ checks: DoctorCheck[], healthy: boolean }`

## `nodePing(mechaDir, name, opts?)`

Pings a mesh node to check reachability. For managed (P2P) nodes, checks the rendezvous server's `/lookup/:name` endpoint. For direct (HTTP) nodes, performs a `/healthz` request.

```ts
import { nodePing } from "@mecha/service";

const result = await nodePing("/Users/you/.mecha", "bob");
// { reachable: true, latencyMs: 42, method: "http" }
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mechaDir` | `string` | Yes | Path to `~/.mecha` |
| `name` | `string` | Yes | Node name to ping |
| `opts.server` | `string` | No | Override rendezvous server URL |

**`PingResult`**

| Field | Type | Description |
|-------|------|-------------|
| `reachable` | `boolean` | Whether the node responded |
| `latencyMs` | `number?` | Round-trip time in milliseconds (only when reachable) |
| `method` | `"http" \| "rendezvous"` | Method used to reach the node |
| `error` | `string?` | Error description when not reachable |

Throws `NodeNotFoundError` if the node name is not in the registry.

## Claude Runtime

Functions for locating the Claude Code CLI binary on the host system.

**Source:** `claude-runtime.ts`

### `ResolvedFrom`

String literal union describing how the Claude binary was found.

```ts
type ResolvedFrom = "local-bin" | "claude-local" | "usr-local" | "usr-bin" | "path" | "not-found";
```

### `ClaudeRuntimeInfo`

Result object returned by `resolveClaudeRuntime()`.

```ts
interface ClaudeRuntimeInfo {
  /** Resolved absolute path to the claude binary, or null if not found. */
  binPath: string | null;
  /** Version string (e.g. "2.1.70"), or null if binary not found or version check failed. */
  version: string | null;
  /** How the binary was found. */
  resolvedFrom: ResolvedFrom;
}
```

### `resolveClaudeRuntime()`

Locates the Claude Code binary, determines its version, and reports how it was found. Searches known install locations in priority order (`~/.local/bin/claude`, `~/.claude/local/bin/claude`, `/usr/local/bin/claude`, `/usr/bin/claude`), then falls back to PATH lookup via `which`. Results are cached for 5 minutes.

```ts
import { resolveClaudeRuntime } from "@mecha/service";

const info = await resolveClaudeRuntime();
// { binPath: "/usr/local/bin/claude", version: "2.1.70", resolvedFrom: "usr-local" }
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| _(none)_ | — | — | — |

**Returns:** `Promise<ClaudeRuntimeInfo>`

### `invalidateClaudeRuntimeCache()`

Clears the cached runtime resolution so the next call to `resolveClaudeRuntime()` performs a fresh lookup. Useful after installing or updating the Claude binary.

```ts
import { invalidateClaudeRuntimeCache } from "@mecha/service";

invalidateClaudeRuntimeCache();
const fresh = await resolveClaudeRuntime();
```

**Returns:** `void`

## Bot Files

Functions for reading and writing files within a bot's home directory. All file operations are security-hardened: symlinks are rejected, hidden path segments are blocked, and only markdown files (`.md`, `.mdx`, `.markdown`) are permitted.

**Source:** `bot-files.ts`

### `DirEntry`

Describes a single directory entry returned by `listBotDir()`.

```ts
interface DirEntry {
  name: string;
  type: "file" | "directory";
  size: number;
  modifiedAt: string; // ISO 8601
}
```

### `resolveBotHome(mechaDir, botName, configHome?)`

Resolves a bot's effective home directory. When `configHome` is set in the bot's config, that path is used directly. Otherwise, defaults to `<mechaDir>/<botName>`.

```ts
import { resolveBotHome } from "@mecha/service";

const home = resolveBotHome("/Users/you/.mecha", "researcher");
// "/Users/you/.mecha/researcher"

const custom = resolveBotHome("/Users/you/.mecha", "researcher", "/opt/bots/researcher");
// "/opt/bots/researcher"
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mechaDir` | `string` | Yes | Path to the Mecha data directory |
| `botName` | `string` | Yes | Bot name |
| `configHome` | `string` | No | Custom home directory override from bot config |

**Returns:** `string`

### `readBotFile(homeDir, relPath)`

Reads a markdown file from a bot's home directory. Rejects non-markdown extensions, hidden path segments, symlinks, and files exceeding 5 MB.

```ts
import { readBotFile } from "@mecha/service";

const content = await readBotFile("/Users/you/.mecha/researcher", "notes/plan.md");
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `homeDir` | `string` | Yes | Bot's effective home directory |
| `relPath` | `string` | Yes | Relative path to the file within home |

**Returns:** `Promise<string>`

**Throws:**

| Error | Condition |
|-------|-----------|
| `NotMarkdownError` | File extension is not `.md`, `.mdx`, or `.markdown` |
| `FileNotFoundError` | File does not exist or is a symlink |
| `FileTooLargeError` | File exceeds 5 MB |
| `PathTraversalError` | Path contains hidden segments or escapes the home directory |

### `writeBotFile(homeDir, relPath, content)`

Writes a markdown file to a bot's home directory. Creates parent directories as needed. Applies the same security checks as `readBotFile`: rejects non-markdown extensions, hidden paths, symlinks, and content exceeding 5 MB.

```ts
import { writeBotFile } from "@mecha/service";

await writeBotFile("/Users/you/.mecha/researcher", "notes/plan.md", "# Plan\n\nStep 1...");
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `homeDir` | `string` | Yes | Bot's effective home directory |
| `relPath` | `string` | Yes | Relative path to the file within home |
| `content` | `string` | Yes | File content to write |

**Returns:** `Promise<void>`

**Throws:**

| Error | Condition |
|-------|-----------|
| `NotMarkdownError` | File extension is not `.md`, `.mdx`, or `.markdown` |
| `FileTooLargeError` | Content exceeds 5 MB |
| `PathTraversalError` | Path contains hidden segments, escapes home, or targets a symlink |

### Error Classes

#### `FileNotFoundError`

Thrown when a requested file does not exist or resolves to a symlink.

```ts
class FileNotFoundError extends Error {
  constructor(path: string);
  name: "FileNotFoundError";
}
```

#### `NotMarkdownError`

Thrown when an operation targets a file that is not a markdown file (`.md`, `.mdx`, `.markdown`).

```ts
class NotMarkdownError extends Error {
  constructor(path: string);
  name: "NotMarkdownError";
}
```

#### `FileTooLargeError`

Thrown when a file or content exceeds the 5 MB size limit.

```ts
class FileTooLargeError extends Error {
  constructor(actual: number, max: number);
  name: "FileTooLargeError";
}
```

## See also

- [@mecha/process](/reference/api/process) — Process lifecycle management used by the service layer
- [@mecha/core](/reference/api/core) — Types and schemas
- [@mecha/meter](/reference/api/meter) — Metering integration
- [API Reference](/reference/api/) — Route summary and package overview
