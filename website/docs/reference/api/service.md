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
| `ensureNodeName` | Function | `node-init.ts` |
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
| `botActivitySnapshot` | Function | `activity.ts` |
| `botActivityStream` | Function | `activity.ts` |
| `ActivitySnapshot` | Type | `activity.ts` |

## Bot Spawn Settings

When spawning a bot via `POST /bots` or updating config via `PATCH /bots/:name/config`, the following optional fields control LLM behavior, tool access, agent identity, MCP, and session settings. All fields are optional.

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

**MCP**

| Field | Type | Description |
|-------|------|-------------|
| `mcpConfigFiles` | `string[]` | MCP config file paths |
| `strictMcpConfig` | `boolean` | Only use specified MCP servers |

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

## Runtime Helpers

Low-level functions for making authenticated HTTP requests to bot runtime servers. Used internally by most other service functions.

**Source:** `helpers.ts`

### `RuntimeFetchOpts`

Options for making an HTTP request to a bot's runtime server.

```ts
interface RuntimeFetchOpts {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}
```

### `RuntimeFetchResult`

Result of a runtime HTTP request, including the parsed body and the raw `Response` object.

```ts
interface RuntimeFetchResult {
  status: number;
  body: unknown;
  raw: Response;
}
```

### `resolveBotEndpoint(pm, name)`

Resolves a running bot's port and auth token from the process manager. Throws typed errors if the bot does not exist or is not running.

```ts
import { resolveBotEndpoint } from "@mecha/service";

const { port, token } = resolveBotEndpoint(pm, "researcher");
// { port: 7700, token: "abc123" }
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pm` | `ProcessManager` | Yes | Process manager instance |
| `name` | `BotName` | Yes | Bot name |

**Returns:** `{ port: number; token: string }`

**Throws:**

| Error | Condition |
|-------|-----------|
| `BotNotFoundError` | Bot is not registered in the process manager |
| `BotNotRunningError` | Bot exists but is not in a running state |

### `runtimeFetch(pm, name, path, opts?)`

Makes an authenticated HTTP request to a running bot's runtime server. Automatically resolves the bot's port and token from the process manager, sets the `Authorization` header, and parses JSON responses.

```ts
import { runtimeFetch } from "@mecha/service";

const result = await runtimeFetch(pm, "researcher", "/api/sessions");
console.log(result.status); // 200
console.log(result.body);   // parsed JSON array of sessions
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pm` | `ProcessManager` | Yes | Process manager instance |
| `name` | `BotName` | Yes | Bot name |
| `path` | `string` | Yes | URL path on the bot's runtime server (e.g., `/api/sessions`) |
| `opts` | `RuntimeFetchOpts` | No | HTTP method, body, and extra headers |

**Returns:** `Promise<RuntimeFetchResult>`

**Throws:** `BotNotFoundError` or `BotNotRunningError` via `resolveBotEndpoint`. Network errors propagate from `fetch`.

### `assertOk(result, code)`

Throws a `MechaError` if the runtime response has a status >= 400. Extracts the error message from the JSON body's `error` field when available.

```ts
import { runtimeFetch, assertOk } from "@mecha/service";

const result = await runtimeFetch(pm, "researcher", "/api/schedules");
assertOk(result, "SCHEDULE_LIST_FAILED"); // throws if status >= 400
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `result` | `RuntimeFetchResult` | Yes | The result from `runtimeFetch` |
| `code` | `string` | Yes | Error code string for the `MechaError` |

**Returns:** `void`

**Throws:** `MechaError` with the given code and the response status when status >= 400.

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

**`FindResult`** -- `ProcessInfo` augmented with `tags: string[]`.

## `botConfigure(mechaDir, pm, name, updates)`

Update a bot's `config.json` with partial changes. The bot must exist in the process manager. Setting `auth` to `null` explicitly clears the auth field from the config.

```ts
import { botConfigure } from "@mecha/service";

botConfigure("/Users/you/.mecha", pm, "researcher", {
  model: "claude-sonnet-4-20250514",
  tags: ["research", "backend"],
  effort: "high",
});
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mechaDir` | `string` | Yes | Path to the Mecha data directory |
| `pm` | `ProcessManager` | Yes | Process manager instance |
| `name` | `BotName` | Yes | Bot name |
| `updates` | `BotConfigUpdates` | Yes | Partial config fields to update |

**Returns:** `void`

**Throws:** `BotNotFoundError` if the bot is not registered in the process manager.

### `BotConfigUpdates`

Partial config fields that can be updated on a bot. All fields are optional.

```ts
interface BotConfigUpdates {
  auth?: string | null;
  model?: string;
  tags?: string[];
  expose?: string[];
  sandboxMode?: "auto" | "off" | "require";
  permissionMode?: string;
  home?: string;
  workspace?: string;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  effort?: "low" | "medium" | "high";
  maxBudgetUsd?: number;
  allowedTools?: string[];
  disallowedTools?: string[];
  tools?: string[];
  agent?: string;
  agents?: Record<string, { description: string; prompt: string }>;
  sessionPersistence?: boolean;
  budgetLimit?: number;
  mcpServers?: Record<string, unknown>;
  mcpConfigFiles?: string[];
  strictMcpConfig?: boolean;
  disableSlashCommands?: boolean;
  addDirs?: string[];
  env?: Record<string, string>;
}
```

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

## Session Management

Functions for listing, fetching, and deleting bot sessions. When the bot is running, these use the runtime API; `botSessionList` falls back to reading session files from disk when the bot is stopped.

**Source:** `sessions.ts`

### `botSessionList(pm, name, mechaDir?)`

List all sessions for a bot. Uses the runtime API (`/api/sessions`) when the bot is running, and falls back to reading `.jsonl` and `.meta.json` files from disk when the bot is stopped or unreachable.

```ts
import { botSessionList } from "@mecha/service";

const sessions = await botSessionList(pm, "researcher", "/Users/you/.mecha");
// [{ id: "abc-123", title: "Fix auth bug", createdAt: "...", updatedAt: "..." }, ...]
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pm` | `ProcessManager` | Yes | Process manager instance |
| `name` | `BotName` | Yes | Bot name |
| `mechaDir` | `string` | No | Path to `~/.mecha` (enables disk fallback when bot is stopped) |

**Returns:** `Promise<unknown[]>` -- Array of session objects.

### `botSessionGet(pm, name, sessionId)`

Get a single session by ID from the bot's runtime API.

```ts
import { botSessionGet } from "@mecha/service";

const session = await botSessionGet(pm, "researcher", "abc-123");
if (session) {
  console.log(session); // session details
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pm` | `ProcessManager` | Yes | Process manager instance |
| `name` | `BotName` | Yes | Bot name |
| `sessionId` | `string` | Yes | Session ID to retrieve |

**Returns:** `Promise<unknown>` -- Session object, or `undefined` if not found.

**Throws:** `SessionFetchError` if the runtime returns a non-200/404 status.

### `botSessionDelete(pm, name, sessionId)`

Delete a session by ID from the bot's runtime.

```ts
import { botSessionDelete } from "@mecha/service";

const deleted = await botSessionDelete(pm, "researcher", "abc-123");
console.log(deleted); // true if session was found and deleted
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pm` | `ProcessManager` | Yes | Process manager instance |
| `name` | `BotName` | Yes | Bot name |
| `sessionId` | `string` | Yes | Session ID to delete |

**Returns:** `Promise<boolean>` -- `true` if deleted, `false` if not found.

**Throws:** `SessionFetchError` if the runtime returns a non-200/404 status.

## Auth Profile Management

Functions for managing Anthropic API credentials stored as named profiles. Profiles support two types: `oauth` (Claude Code OAuth tokens) and `api-key` (Anthropic API keys). Credentials are stored separately from profile metadata with restricted file permissions (0o600).

**Source:** `auth.ts`, `auth-probe.ts`

### `AuthProfile`

Public profile view returned by all auth service functions.

```ts
interface AuthProfile {
  name: string;
  type: "oauth" | "api-key";
  account: string | null;
  label: string;
  isDefault: boolean;
  tags: string[];
  expiresAt: number | null;
  createdAt: string;
}
```

### `AuthAddOpts`

Options for creating an auth profile via `mechaAuthAddFull`.

```ts
interface AuthAddOpts {
  name: string;
  type: "oauth" | "api-key";
  token: string;
  account?: string | null;
  label?: string;
  tags?: string[];
  expiresAt?: number | null;
}
```

### `mechaAuthAdd(mechaDir, name, type, token, tags?)`

Add an auth profile with positional arguments. Convenience wrapper around `mechaAuthAddFull`. The first profile added becomes the default.

```ts
import { mechaAuthAdd } from "@mecha/service";

const profile = mechaAuthAdd("/Users/you/.mecha", "work", "api-key", "sk-ant-...", ["production"]);
// { name: "work", type: "api-key", isDefault: true, tags: ["production"], ... }
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mechaDir` | `string` | Yes | Path to `~/.mecha` |
| `name` | `string` | Yes | Profile name (must match `[a-zA-Z0-9._-]+`) |
| `type` | `"oauth" \| "api-key"` | Yes | Credential type |
| `token` | `string` | Yes | The credential token |
| `tags` | `string[]` | No | Tags for filtering (defaults to `[]`) |

**Returns:** `AuthProfile`

**Throws:**

| Error | Condition |
|-------|-----------|
| `InvalidNameError` | Profile name contains invalid characters |
| `AuthProfileAlreadyExistsError` | A profile with that name already exists |

### `mechaAuthAddFull(mechaDir, opts)`

Add an auth profile with full options. The first profile added becomes the default. Writes are transactional: if credentials fail to write, the profile metadata is reverted.

```ts
import { mechaAuthAddFull } from "@mecha/service";

const profile = mechaAuthAddFull("/Users/you/.mecha", {
  name: "personal",
  type: "oauth",
  token: "oauth-token-...",
  label: "My personal account",
  tags: ["dev"],
});
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mechaDir` | `string` | Yes | Path to `~/.mecha` |
| `opts` | `AuthAddOpts` | Yes | Full profile creation options |

**Returns:** `AuthProfile`

**Throws:** `InvalidNameError`, `AuthProfileAlreadyExistsError` (same as `mechaAuthAdd`).

### `mechaAuthLs(mechaDir)`

List all auth profiles, including synthetic entries for environment variable credentials (`ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`).

```ts
import { mechaAuthLs } from "@mecha/service";

const profiles = mechaAuthLs("/Users/you/.mecha");
// [
//   { name: "work", type: "api-key", isDefault: true, ... },
//   { name: "$env:api-key", type: "api-key", label: "ANTHROPIC_API_KEY (env)", ... },
// ]
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mechaDir` | `string` | Yes | Path to `~/.mecha` |

**Returns:** `AuthProfile[]` -- Stored profiles followed by any detected environment variable profiles (tagged `["env"]`).

### `mechaAuthDefault(mechaDir, name)`

Set the default auth profile by name.

```ts
import { mechaAuthDefault } from "@mecha/service";

mechaAuthDefault("/Users/you/.mecha", "personal");
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mechaDir` | `string` | Yes | Path to `~/.mecha` |
| `name` | `string` | Yes | Profile name to set as default |

**Returns:** `void`

**Throws:** `AuthProfileNotFoundError` if no profile with that name exists.

### `mechaAuthRm(mechaDir, name)`

Remove an auth profile and its credentials. If the removed profile was the default, the first remaining profile becomes the new default.

```ts
import { mechaAuthRm } from "@mecha/service";

mechaAuthRm("/Users/you/.mecha", "old-key");
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mechaDir` | `string` | Yes | Path to `~/.mecha` |
| `name` | `string` | Yes | Profile name to remove |

**Returns:** `void`

**Throws:** `AuthProfileNotFoundError` if no profile with that name exists.

### `mechaAuthTag(mechaDir, name, tags)`

Replace the tags on an auth profile.

```ts
import { mechaAuthTag } from "@mecha/service";

mechaAuthTag("/Users/you/.mecha", "work", ["production", "billing"]);
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mechaDir` | `string` | Yes | Path to `~/.mecha` |
| `name` | `string` | Yes | Profile name |
| `tags` | `string[]` | Yes | New tags (replaces existing) |

**Returns:** `void`

**Throws:** `AuthProfileNotFoundError` if no profile with that name exists.

### `mechaAuthSwitch(mechaDir, name)`

Switch the default auth profile and return the newly active profile.

```ts
import { mechaAuthSwitch } from "@mecha/service";

const profile = mechaAuthSwitch("/Users/you/.mecha", "personal");
console.log(profile.isDefault); // true
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mechaDir` | `string` | Yes | Path to `~/.mecha` |
| `name` | `string` | Yes | Profile name to switch to |

**Returns:** `AuthProfile`

**Throws:** `AuthProfileNotFoundError` if no profile with that name exists.

### `mechaAuthTest(mechaDir, name)`

Test if an auth profile has a non-empty credential. This is a local-only check -- it does not call the Anthropic API. Use `mechaAuthProbe` for live API validation.

```ts
import { mechaAuthTest } from "@mecha/service";

const { valid, profile } = mechaAuthTest("/Users/you/.mecha", "work");
console.log(valid); // true if the credential token is non-empty
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mechaDir` | `string` | Yes | Path to `~/.mecha` |
| `name` | `string` | Yes | Profile name to test |

**Returns:** `{ valid: boolean; profile: AuthProfile }`

**Throws:** `AuthProfileNotFoundError` if no profile with that name exists.

### `mechaAuthRenew(mechaDir, name, newToken)`

Replace the credential token for an existing auth profile.

```ts
import { mechaAuthRenew } from "@mecha/service";

const profile = mechaAuthRenew("/Users/you/.mecha", "work", "sk-ant-new-...");
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mechaDir` | `string` | Yes | Path to `~/.mecha` |
| `name` | `string` | Yes | Profile name |
| `newToken` | `string` | Yes | Replacement credential token |

**Returns:** `AuthProfile`

**Throws:** `AuthProfileNotFoundError` if no profile with that name exists.

### `mechaAuthGet(mechaDir, name)`

Get a single auth profile by name, or `undefined` if not found.

```ts
import { mechaAuthGet } from "@mecha/service";

const profile = mechaAuthGet("/Users/you/.mecha", "work");
if (profile) {
  console.log(profile.type); // "api-key"
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mechaDir` | `string` | Yes | Path to `~/.mecha` |
| `name` | `string` | Yes | Profile name |

**Returns:** `AuthProfile | undefined`

### `mechaAuthGetDefault(mechaDir)`

Get the current default auth profile, or `undefined` if none is set.

```ts
import { mechaAuthGetDefault } from "@mecha/service";

const defaultProfile = mechaAuthGetDefault("/Users/you/.mecha");
if (defaultProfile) {
  console.log(defaultProfile.name); // "work"
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mechaDir` | `string` | Yes | Path to `~/.mecha` |

**Returns:** `AuthProfile | undefined`

### `mechaAuthSwitchBot(mechaDir, pm, botName, profileName)`

Assign an auth profile to a specific bot by writing the profile name into the bot's `config.json`. Supports both stored profiles and environment variable sentinel profiles (`$env:api-key`, `$env:oauth`).

```ts
import { mechaAuthSwitchBot } from "@mecha/service";

const profile = mechaAuthSwitchBot("/Users/you/.mecha", pm, "researcher", "work");
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mechaDir` | `string` | Yes | Path to `~/.mecha` |
| `pm` | `ProcessManager` | Yes | Process manager instance |
| `botName` | `BotName` | Yes | Bot name to assign the profile to |
| `profileName` | `string` | Yes | Profile name (stored or `$env:*` sentinel) |

**Returns:** `AuthProfile`

**Throws:**

| Error | Condition |
|-------|-----------|
| `AuthProfileNotFoundError` | Profile name not found (or `$env:` sentinel with missing env var) |
| `BotNotFoundError` | Bot is not registered in the process manager |

### `mechaAuthProbe(mechaDir, name)`

Test an auth profile by making a live HTTP request to the Anthropic API (`GET /v1/models`). Returns validity status and any error description. Uses a 15-second timeout.

```ts
import { mechaAuthProbe } from "@mecha/service";

const { valid, error } = await mechaAuthProbe("/Users/you/.mecha", "work");
if (!valid) {
  console.log("Auth probe failed:", error);
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mechaDir` | `string` | Yes | Path to `~/.mecha` |
| `name` | `string` | Yes | Profile name to probe |

**Returns:** `Promise<{ valid: boolean; error?: string; profile: AuthProfile }>`

**Throws:** `AuthProfileNotFoundError` if no profile with that name exists.

## Tool Management

Functions for installing, listing, and removing tool packages in the Mecha data directory. Tools are stored as directories under `<mechaDir>/tools/<name>/` with a `manifest.json` file.

**Source:** `tools.ts`

### `ToolInfo`

Metadata for an installed tool.

```ts
interface ToolInfo {
  name: string;
  version: string;
  description: string;
}
```

### `ToolInstallOpts`

Options for installing a tool.

```ts
interface ToolInstallOpts {
  name: string;
  version?: string;
  description?: string;
}
```

### `mechaToolInstall(mechaDir, opts)`

Install a tool by writing a manifest file. Validates the tool name against path traversal and invalid characters. Currently a stub -- full implementation will download and validate tool packages.

```ts
import { mechaToolInstall } from "@mecha/service";

const tool = mechaToolInstall("/Users/you/.mecha", {
  name: "code-review",
  version: "1.0.0",
  description: "Automated code review tool",
});
// { name: "code-review", version: "1.0.0", description: "Automated code review tool" }
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mechaDir` | `string` | Yes | Path to `~/.mecha` |
| `opts` | `ToolInstallOpts` | Yes | Tool name, version, and description |

**Returns:** `ToolInfo`

**Throws:** `InvalidToolNameError` if the name contains invalid characters or path traversal sequences.

### `mechaToolLs(mechaDir)`

List all installed tools by reading manifests from the tools directory.

```ts
import { mechaToolLs } from "@mecha/service";

const tools = mechaToolLs("/Users/you/.mecha");
// [{ name: "code-review", version: "1.0.0", description: "..." }]
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mechaDir` | `string` | Yes | Path to `~/.mecha` |

**Returns:** `ToolInfo[]` -- Empty array if no tools are installed.

### `mechaToolRemove(mechaDir, name)`

Remove an installed tool by name. Deletes the tool directory recursively.

```ts
import { mechaToolRemove } from "@mecha/service";

const removed = mechaToolRemove("/Users/you/.mecha", "code-review");
console.log(removed); // true if found and removed
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mechaDir` | `string` | Yes | Path to `~/.mecha` |
| `name` | `string` | Yes | Tool name to remove |

**Returns:** `boolean` -- `true` if the tool was found and removed, `false` if it did not exist.

**Throws:** `InvalidToolNameError` if the name contains invalid characters or path traversal sequences.

## `mechaInit(mechaDir)`

Initialize Mecha data directory at `~/.mecha/`. Creates directory structure, generates node identity, and writes default configuration.

```ts
import { mechaInit } from "@mecha/service";

const result = mechaInit("/Users/you/.mecha");
// { created: true, mechaDir: "/Users/you/.mecha", nodeId: "abc-123", fingerprint: "SHA256:..." }
```

**`InitResult`** -- `{ mechaDir: string, nodeId: string, fingerprint?: string, created: boolean }`

## `mechaDoctor(mechaDir)`

Run system health checks. Returns a list of checks with pass/fail status.

```ts
import { mechaDoctor } from "@mecha/service";

const result = mechaDoctor("/Users/you/.mecha");
for (const check of result.checks) {
  console.log(`${check.status === "ok" ? "PASS" : "FAIL"} ${check.name}: ${check.message}`);
}
```

**`DoctorCheck`** -- `{ name: string, status: "ok" | "warn" | "error", message: string }`

**`DoctorResult`** -- `{ checks: DoctorCheck[], healthy: boolean }`

## Activity Monitoring

Functions for observing real-time bot activity. The snapshot endpoint provides a point-in-time view; the stream endpoint provides a continuous SSE feed.

**Source:** `activity.ts`

### `ActivitySnapshot`

Current activity snapshot from a bot.

```ts
interface ActivitySnapshot {
  name: string;
  activity: string;
  timestamp: string;
}
```

### `botActivitySnapshot(pm, name)`

Fetch the current activity snapshot from a bot's `/api/events/snapshot` endpoint. Uses a 5-second timeout.

```ts
import { botActivitySnapshot } from "@mecha/service";

const snap = await botActivitySnapshot(pm, "researcher");
console.log(snap.activity);  // "Analyzing code..."
console.log(snap.timestamp); // "2026-03-21T10:15:30.000Z"
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pm` | `ProcessManager` | Yes | Process manager instance |
| `name` | `BotName` | Yes | Bot name |

**Returns:** `Promise<ActivitySnapshot>`

**Throws:** Error if the bot is not running or the endpoint returns a non-OK status.

### `botActivityStream(pm, name, signal?)`

Stream activity events from a bot's `/api/events` SSE endpoint. Returns an async generator that yields parsed JSON objects from SSE `data:` lines.

```ts
import { botActivityStream } from "@mecha/service";

const controller = new AbortController();
for await (const event of botActivityStream(pm, "researcher", controller.signal)) {
  console.log(event); // parsed SSE event object
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pm` | `ProcessManager` | Yes | Process manager instance |
| `name` | `BotName` | Yes | Bot name |
| `signal` | `AbortSignal` | No | Abort signal to stop streaming |

**Returns:** `AsyncGenerator<Record<string, unknown>>` -- Yields parsed SSE event objects.

**Throws:** Error if the bot is not running, the endpoint returns a non-OK status, or the response body is missing.

## Hierarchy

Functions for organizing bots into a tree structure based on their workspace paths. A bot whose workspace is a subdirectory of another bot's workspace becomes its child in the tree.

**Source:** `hierarchy.ts`

### `HierarchyNode`

A node in the workspace-path hierarchy tree.

```ts
interface HierarchyNode {
  bot: FindResult;
  children: HierarchyNode[];
  depth: number;
}
```

### `buildHierarchy(bots)`

Build a tree of bots based on workspace path nesting. Bots are sorted by workspace path length so parents are processed before children. A bot is considered a child of another if its `workspacePath` starts with the parent's path followed by `/`.

```ts
import { botFind, buildHierarchy } from "@mecha/service";

const bots = botFind("/Users/you/.mecha", pm, {});
const roots = buildHierarchy(bots);
// roots[0].bot.name === "monorepo"
// roots[0].children[0].bot.name === "frontend"  (workspace: /project/packages/frontend)
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `bots` | `FindResult[]` | Yes | Array of bot find results to organize |

**Returns:** `HierarchyNode[]` -- Root nodes of the hierarchy tree.

### `flattenHierarchy(roots)`

Flatten a hierarchy tree to a display-order list with depth info. Performs a depth-first traversal.

```ts
import { buildHierarchy, flattenHierarchy } from "@mecha/service";

const roots = buildHierarchy(bots);
const flat = flattenHierarchy(roots);
for (const { bot, depth } of flat) {
  console.log(`${"  ".repeat(depth)}${bot.name}`);
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `roots` | `HierarchyNode[]` | Yes | Root nodes from `buildHierarchy` |

**Returns:** `{ bot: FindResult; depth: number }[]` -- Flattened list in display order.

## Bot Router

Mediated inter-bot communication with ACL enforcement. The router resolves bot addresses to local or remote endpoints and enforces access control before every request.

**Source:** `router.ts`

### `BotRouter`

Router interface for inter-bot communication.

```ts
interface BotRouter {
  routeQuery(source: string, target: string, message: string, sessionId?: string): Promise<ForwardResult>;
  routeDiscover(source: BotName, opts: { tags?: string[]; capability?: Capability }): FindResult[];
}
```

**`routeQuery`** -- Route a query from source to target bot. Checks ACL, resolves the target to a local or remote endpoint, and forwards the message. Returns `ForwardResult` with the response text and optional session ID.

**`routeDiscover`** -- List bots visible to the source bot, filtered by ACL grants. Optionally filters by tags and required capability (checking the bot's `expose` config).

### `CreateRouterOpts`

Options for creating a bot router.

```ts
interface CreateRouterOpts {
  mechaDir: string;
  acl: AclEngine;
  pm: ProcessManager;
  locator?: MechaLocator;
  agentFetch?: typeof agentFetch;
  sourceName?: string;
  allowPrivateHosts?: boolean;
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `mechaDir` | `string` | Yes | Path to `~/.mecha` |
| `acl` | `AclEngine` | Yes | ACL engine for permission checks |
| `pm` | `ProcessManager` | Yes | Process manager instance |
| `locator` | `MechaLocator` | No | Bot address locator for local/remote resolution |
| `agentFetch` | `typeof agentFetch` | No | Transport function for remote node requests |
| `sourceName` | `string` | No | This node's name (appended to source addresses for remote routing) |
| `allowPrivateHosts` | `boolean` | No | Allow private/loopback hosts (for local dev/testing) |

### `createBotRouter(opts)`

Create a bot router instance for mediated inter-bot communication. The router checks ACL permissions before every request, then routes locally via `forwardQueryToBot` or remotely via `agentFetch`.

```ts
import { createBotRouter, createLocator } from "@mecha/service";

const router = createBotRouter({
  mechaDir: "/Users/you/.mecha",
  acl: aclEngine,
  pm: processManager,
  locator: createLocator({ mechaDir, pm, getNodes }),
});

const result = await router.routeQuery("alice", "bob@local", "Hello!");
console.log(result.text); // Bob's response
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `opts` | `CreateRouterOpts` | Yes | Router configuration |

**Returns:** `BotRouter`

**Throws:**

| Error | Condition |
|-------|-----------|
| `AclDeniedError` | Source bot does not have permission to query the target |
| `BotNotFoundError` | Target bot cannot be located |
| `RemoteRoutingError` | Remote node returned a non-OK response |

## Locator

Resolves bot addresses (local or remote) to endpoints for routing.

**Source:** `locator.ts`

### `LocateResult`

Result of locating a bot. One of four variants:

```ts
type LocateResult =
  | { location: "local"; port: number; token: string }
  | { location: "remote"; node: NodeEntry }
  | { location: "remote-channel"; node: NodeEntry }
  | { location: "not_found" };
```

| Variant | Description |
|---------|-------------|
| `local` | Bot is running on this node; includes port and auth token |
| `remote` | Bot is on a remote node reachable via HTTP |
| `remote-channel` | Bot is on a managed remote node requiring SecureChannel |
| `not_found` | Bot could not be located |

### `MechaLocator`

Interface for resolving bot addresses.

```ts
interface MechaLocator {
  locate(target: BotAddress): LocateResult;
}
```

### `CreateLocatorOpts`

Options for creating a locator.

```ts
interface CreateLocatorOpts {
  mechaDir: string;
  pm: ProcessManager;
  getNodes: () => NodeEntry[];
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `mechaDir` | `string` | Yes | Path to `~/.mecha` |
| `pm` | `ProcessManager` | Yes | Process manager for local bot lookup |
| `getNodes` | `() => NodeEntry[]` | Yes | Function returning registered peer nodes |

### `createLocator(opts)`

Create a locator that resolves `BotAddress` objects to local or remote endpoints. For local addresses, checks the process manager for a running bot and reads its config for port/token. For remote addresses, looks up the target node in the registry.

```ts
import { createLocator } from "@mecha/service";

const locator = createLocator({
  mechaDir: "/Users/you/.mecha",
  pm: processManager,
  getNodes: () => readNodes(mechaDir),
});

const result = locator.locate({ bot: "researcher", node: "local" });
if (result.location === "local") {
  console.log(result.port); // 7700
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `opts` | `CreateLocatorOpts` | Yes | Locator configuration |

**Returns:** `MechaLocator`

## Agent Fetch

Makes authenticated HTTP requests to remote node agent servers. Supports both raw HTTP and encrypted SecureChannel transport.

**Source:** `agent-fetch.ts`

### `SecureChannelLike`

Minimal interface for an encrypted communication channel (avoids importing `@mecha/connect` as a dependency).

```ts
interface SecureChannelLike {
  readonly isOpen: boolean;
  send(data: Uint8Array): void;
  onMessage(handler: (data: Uint8Array) => void): void;
  offMessage(handler: (data: Uint8Array) => void): void;
  onError?(handler: (err: Error) => void): void;
  offError?(handler: (err: Error) => void): void;
  onClose?(handler: (reason: string) => void): void;
  offClose?(handler: (reason: string) => void): void;
}
```

### `AgentFetchOpts`

Options for making an authenticated request to a remote node's agent server.

```ts
interface AgentFetchOpts {
  node: NodeEntry;
  path: string;
  method?: string;
  body?: unknown;
  source?: string;
  signFn?: (data: Uint8Array) => Uint8Array;
  timeoutMs?: number;
  allowPrivateHosts?: boolean;
  channel?: SecureChannelLike;
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `node` | `NodeEntry` | Yes | Target node entry from the registry |
| `path` | `string` | Yes | URL path on the remote agent server |
| `method` | `string` | No | HTTP method (defaults to `"GET"`) |
| `body` | `unknown` | No | Request body (JSON-serialized) |
| `source` | `string` | No | Source identifier added as `X-Mecha-Source` header |
| `signFn` | `(data: Uint8Array) => Uint8Array` | No | Signing function for request authentication |
| `timeoutMs` | `number` | No | Request timeout in milliseconds (defaults to `DEFAULTS.FORWARD_TIMEOUT_MS`) |
| `allowPrivateHosts` | `boolean` | No | Allow private/loopback hosts (default: `false`) |
| `channel` | `SecureChannelLike` | No | Use an existing SecureChannel instead of raw HTTP |

### `agentFetch(opts)`

Make an authenticated HTTP request to a remote node's agent server. Sets `Bearer` auth, optional `X-Mecha-Source` and `X-Mecha-Signature` headers. When a `signFn` is provided, computes a canonical signature over the method, path, source, timestamp, nonce, and body.

If a `SecureChannelLike` is provided and open, the request is tunneled over the encrypted channel instead of making a raw HTTP call. Managed nodes always require a SecureChannel -- calling without one throws `ConnectError`.

```ts
import { agentFetch } from "@mecha/service";

const response = await agentFetch({
  node: { name: "bob", host: "192.168.1.50", port: 7660, apiKey: "key-...", addedAt: "..." },
  path: "/bots/researcher/query",
  method: "POST",
  body: { message: "Hello from alice" },
  source: "alice@my-node",
});
const data = await response.json();
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `opts` | `AgentFetchOpts` | Yes | Request configuration |

**Returns:** `Promise<Response>` -- Standard `fetch` Response object.

**Throws:**

| Error | Condition |
|-------|-----------|
| `ConnectError` | Managed node without an open SecureChannel |
| Network errors | Standard `fetch` errors (timeout, DNS, connection refused) |

## Node Identity

Functions for initializing and reading the local node identity. Each machine is assigned a unique node name stored in `<mechaDir>/node.json`.

**Source:** `node-init.ts`

### `NodeInitResult`

Result of node initialization.

```ts
interface NodeInitResult {
  name: NodeName;
  created: boolean;
}
```

### `nodeInit(mechaDir, opts?)`

Initialize this machine as a named node. Auto-generates a name from `os.hostname()` plus a 4-character hash if no name is provided. Idempotent: returns the existing name if already initialized. Also creates cryptographic identity keys required for mesh networking.

```ts
import { nodeInit } from "@mecha/service";

const result = nodeInit("/Users/you/.mecha");
// { name: "macbook-a1b2", created: true }

const existing = nodeInit("/Users/you/.mecha");
// { name: "macbook-a1b2", created: false }
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mechaDir` | `string` | Yes | Path to `~/.mecha` |
| `opts` | `{ name?: string }` | No | Optional explicit node name |

**Returns:** `NodeInitResult`

**Throws:**

| Error | Condition |
|-------|-----------|
| `InvalidNameError` | Provided or existing name fails validation |
| `CorruptConfigError` | Existing `node.json` is malformed |

### `readNodeName(mechaDir)`

Read the current node name from `node.json`, if the node has been initialized.

```ts
import { readNodeName } from "@mecha/service";

const name = readNodeName("/Users/you/.mecha");
if (name) {
  console.log(`This node is: ${name}`);
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mechaDir` | `string` | Yes | Path to `~/.mecha` |

**Returns:** `NodeName | undefined` -- The node name, or `undefined` if not initialized or the config is corrupt.

### `ensureNodeName(mechaDir)`

Read the node name, or auto-initialize if not yet set. Convenience wrapper used by CLI commands.

```ts
import { ensureNodeName } from "@mecha/service";

const name = ensureNodeName("/Users/you/.mecha");
// Always returns a NodeName (initializes if needed)
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mechaDir` | `string` | Yes | Path to `~/.mecha` |

**Returns:** `NodeName`

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

## Task Check

Check whether a bot has active sessions to determine if it is safe to stop or restart.

**Source:** `task-check.ts`

### `TaskCheckResult`

Result of a busy check.

```ts
interface TaskCheckResult {
  busy: boolean;
  activeSessions: number;
  lastActivity?: string;
}
```

| Field | Type | Description |
|-------|------|-------------|
| `busy` | `boolean` | Whether the bot has recently active sessions |
| `activeSessions` | `number` | Number of sessions updated within the recency window |
| `lastActivity` | `string?` | ISO 8601 timestamp of the most recently updated session |

### `checkBotBusy(pm, name, recencyMs?)`

Check if a bot has recently active sessions. A session is considered active if its `updatedAt` timestamp is within the `recencyMs` window (default: 60 seconds). Fails open: returns `busy: false` when the bot is not running or unreachable.

```ts
import { checkBotBusy } from "@mecha/service";

const result = await checkBotBusy(pm, "researcher");
if (result.busy) {
  console.log(`Bot has ${result.activeSessions} active session(s), last active: ${result.lastActivity}`);
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pm` | `ProcessManager` | Yes | Process manager instance |
| `name` | `BotName` | Yes | Bot name |
| `recencyMs` | `number` | No | Recency window in milliseconds (default: `60000`) |

**Returns:** `Promise<TaskCheckResult>`

## Batch Operations

Run stop or restart operations across multiple bots with busy-check semantics and bounded parallelism.

**Source:** `bot-batch.ts`

### `BatchItemResult`

Per-bot result from a batch operation.

```ts
interface BatchItemResult {
  name: string;
  status: "succeeded" | "skipped_busy" | "skipped_stopped" | "failed";
  error?: string;
  activeSessions?: number;
  lastActivity?: string;
}
```

| Status | Meaning |
|--------|---------|
| `succeeded` | Operation completed successfully |
| `skipped_busy` | Bot was busy and `idleOnly` was set |
| `skipped_stopped` | Bot was already stopped (for stop operations) |
| `failed` | Operation failed (busy without force/idleOnly, or runtime error) |

### `BatchResult`

Aggregate result of a batch operation.

```ts
interface BatchResult {
  results: BatchItemResult[];
  summary: { succeeded: number; skipped: number; failed: number };
}
```

### `BatchActionOpts`

Options for running a batch stop/restart across bots.

```ts
interface BatchActionOpts {
  pm: ProcessManager;
  mechaDir: string;
  action: "stop" | "restart";
  force?: boolean;
  idleOnly?: boolean;
  dryRun?: boolean;
  concurrency?: number;
  names?: string[];
  onProgress?: (result: BatchItemResult) => void;
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `pm` | `ProcessManager` | Yes | Process manager instance |
| `mechaDir` | `string` | Yes | Path to `~/.mecha` |
| `action` | `"stop" \| "restart"` | Yes | Operation to perform |
| `force` | `boolean` | No | Bypass busy check entirely |
| `idleOnly` | `boolean` | No | Skip busy bots silently (counted as skipped, not failed) |
| `dryRun` | `boolean` | No | Report what would happen without executing |
| `concurrency` | `number` | No | Max parallel operations (default: `4`, minimum: `1`) |
| `names` | `string[]` | No | Limit to specific bot names (all bots when omitted) |
| `onProgress` | `(result: BatchItemResult) => void` | No | Callback invoked per-bot as each completes |

### `batchBotAction(opts)`

Run a batch stop/restart across all bots (or a subset). Returns per-bot results with a summary.

Busy-check semantics:
- **`force`**: bypass busy check entirely
- **`idleOnly`**: skip busy bots silently (counted as skipped)
- **default**: busy bots are counted as failed (operation refused)

For restarts, the function stops the bot, waits for the port to be released (up to 5 seconds), then respawns with the same config.

```ts
import { batchBotAction } from "@mecha/service";

const result = await batchBotAction({
  pm: processManager,
  mechaDir: "/Users/you/.mecha",
  action: "restart",
  idleOnly: true,
  onProgress: (r) => console.log(`${r.name}: ${r.status}`),
});
console.log(result.summary); // { succeeded: 3, skipped: 1, failed: 0 }
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `opts` | `BatchActionOpts` | Yes | Batch operation configuration |

**Returns:** `Promise<BatchResult>`

## Bot Enrichment

Functions for combining process info with config, auth, and meter data into a single enriched view. Designed for dashboard list views where multiple I/O sources need to be merged efficiently.

**Source:** `bot-enrich.ts`

### `EnrichedBotInfo`

Bot info enriched with config, auth type, and meter cost data.

```ts
interface EnrichedBotInfo {
  name: string;
  state: "running" | "stopped" | "error";
  pid?: number;
  port?: number;
  workspacePath: string;
  homeDir?: string;
  startedAt?: string;
  stoppedAt?: string;
  exitCode?: number;
  model?: string;
  sandboxMode?: string;
  permissionMode?: string;
  tags?: string[];
  auth?: string;
  authType?: "oauth" | "api-key";
  costToday?: number;
}
```

### `EnrichContext`

Pre-loaded context for enriching bot info. All I/O happens during context construction so that `enrichBotInfo` itself is a pure function.

```ts
interface EnrichContext {
  configs: Map<string, BotConfig>;
  snapshot: HotSnapshot | null;
  authStore: AuthProfileStore;
}
```

### `buildEnrichContext(mechaDir, snapshot, botNames)`

Build the enrichment context by reading bot configs and the auth profile store. Call once per request, then pass the context to `enrichBotInfo` for each bot.

```ts
import { buildEnrichContext, enrichBotInfo, getCachedSnapshot } from "@mecha/service";

const snapshot = getCachedSnapshot(meterDir);
const bots = pm.list();
const ctx = buildEnrichContext("/Users/you/.mecha", snapshot, bots.map((b) => b.name));

const enriched = bots.map((bot) => enrichBotInfo(bot, ctx));
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mechaDir` | `string` | Yes | Path to `~/.mecha` |
| `snapshot` | `HotSnapshot \| null` | Yes | Meter snapshot (from `getCachedSnapshot`) or `null` |
| `botNames` | `string[]` | Yes | Bot names to load configs for |

**Returns:** `EnrichContext`

### `enrichBotInfo(info, ctx)`

Pure mapper that merges `ProcessInfo` with config, auth type, and meter cost data. Does not perform any I/O.

```ts
import { enrichBotInfo } from "@mecha/service";

const enriched = enrichBotInfo(processInfo, ctx);
console.log(enriched.model);     // "claude-sonnet-4-20250514"
console.log(enriched.authType);  // "api-key"
console.log(enriched.costToday); // 0.42
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `info` | `ProcessInfo` | Yes | Process info from the process manager |
| `ctx` | `EnrichContext` | Yes | Pre-loaded enrichment context |

**Returns:** `EnrichedBotInfo`

## Snapshot Cache

In-memory cache for meter snapshots to avoid synchronous disk reads on every request.

**Source:** `snapshot-cache.ts`

### `getCachedSnapshot(meterDir)`

Read the meter snapshot with in-memory caching (5-second TTL). Returns the cached snapshot if the same directory was read within the TTL window, otherwise performs a fresh disk read.

```ts
import { getCachedSnapshot } from "@mecha/service";

const snapshot = getCachedSnapshot("/Users/you/.mecha/meter");
if (snapshot) {
  console.log(snapshot.ts); // snapshot timestamp
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `meterDir` | `string` | Yes | Path to the meter data directory |

**Returns:** `HotSnapshot | null` -- The snapshot, or `null` if no snapshot file exists.

### `invalidateSnapshotCache()`

Clear the cached snapshot so the next call to `getCachedSnapshot` performs a fresh disk read. Useful for testing or forcing a manual refresh.

```ts
import { invalidateSnapshotCache } from "@mecha/service";

invalidateSnapshotCache();
```

**Returns:** `void`

## Schedule Management

Functions for managing scheduled prompts on bots. Schedules run at fixed intervals and are persisted in the bot's runtime. All schedule functions communicate with the bot's runtime API.

**Source:** `schedule.ts`

### `botScheduleAdd(pm, name, opts)`

Add a scheduled prompt to a bot. Validates the interval client-side before sending to the runtime. The interval string uses human-readable format (e.g., `"30m"`, `"2h"`, `"1d"`).

```ts
import { botScheduleAdd } from "@mecha/service";

await botScheduleAdd(pm, "researcher", {
  id: "daily-summary",
  every: "24h",
  prompt: "Summarize today's findings",
});
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pm` | `ProcessManager` | Yes | Process manager instance |
| `name` | `BotName` | Yes | Bot name |
| `opts.id` | `string` | Yes | Schedule entry ID |
| `opts.every` | `string` | Yes | Interval string (e.g., `"30m"`, `"2h"`, `"1d"`) |
| `opts.prompt` | `string` | Yes | Prompt to execute on each trigger |

**Returns:** `Promise<void>`

**Throws:**

| Error | Condition |
|-------|-----------|
| `InvalidIntervalError` | Interval string cannot be parsed |
| `MechaError` | Runtime returned an error (code: `SCHEDULE_ADD_FAILED`) |

### `botScheduleRemove(pm, name, scheduleId)`

Remove a schedule entry from a bot by schedule ID.

```ts
import { botScheduleRemove } from "@mecha/service";

await botScheduleRemove(pm, "researcher", "daily-summary");
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pm` | `ProcessManager` | Yes | Process manager instance |
| `name` | `BotName` | Yes | Bot name |
| `scheduleId` | `string` | Yes | Schedule entry ID to remove |

**Returns:** `Promise<void>`

**Throws:** `MechaError` with code `SCHEDULE_REMOVE_FAILED` if the runtime returns an error.

### `botScheduleList(pm, name)`

List all schedule entries for a bot.

```ts
import { botScheduleList } from "@mecha/service";

const schedules = await botScheduleList(pm, "researcher");
for (const s of schedules) {
  console.log(`${s.id}: every ${s.trigger.every} — ${s.prompt}`);
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pm` | `ProcessManager` | Yes | Process manager instance |
| `name` | `BotName` | Yes | Bot name |

**Returns:** `Promise<ScheduleEntry[]>` -- Array of schedule entries. Each entry has `id`, `trigger` (with `every` interval), `prompt`, and optional `paused` flag.

**Throws:** `MechaError` with code `SCHEDULE_LIST_FAILED` if the runtime returns an error.

### `botSchedulePause(pm, name, scheduleId?)`

Pause a single schedule or all schedules for a bot. When `scheduleId` is omitted, pauses all schedules.

```ts
import { botSchedulePause } from "@mecha/service";

// Pause one schedule
await botSchedulePause(pm, "researcher", "daily-summary");

// Pause all schedules
await botSchedulePause(pm, "researcher");
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pm` | `ProcessManager` | Yes | Process manager instance |
| `name` | `BotName` | Yes | Bot name |
| `scheduleId` | `string` | No | Schedule ID to pause (omit to pause all) |

**Returns:** `Promise<void>`

**Throws:** `MechaError` with code `SCHEDULE_PAUSE_FAILED` if the runtime returns an error.

### `botScheduleResume(pm, name, scheduleId?)`

Resume a single schedule or all schedules for a bot. When `scheduleId` is omitted, resumes all schedules.

```ts
import { botScheduleResume } from "@mecha/service";

// Resume one schedule
await botScheduleResume(pm, "researcher", "daily-summary");

// Resume all schedules
await botScheduleResume(pm, "researcher");
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pm` | `ProcessManager` | Yes | Process manager instance |
| `name` | `BotName` | Yes | Bot name |
| `scheduleId` | `string` | No | Schedule ID to resume (omit to resume all) |

**Returns:** `Promise<void>`

**Throws:** `MechaError` with code `SCHEDULE_RESUME_FAILED` if the runtime returns an error.

### `botScheduleRun(pm, name, scheduleId)`

Trigger an immediate run of a schedule entry, regardless of its interval.

```ts
import { botScheduleRun } from "@mecha/service";

const result = await botScheduleRun(pm, "researcher", "daily-summary");
console.log(result.outcome);    // "success" | "error" | "skipped"
console.log(result.durationMs); // 4200
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pm` | `ProcessManager` | Yes | Process manager instance |
| `name` | `BotName` | Yes | Bot name |
| `scheduleId` | `string` | Yes | Schedule entry ID to trigger |

**Returns:** `Promise<ScheduleRunResult>` -- Outcome record with `scheduleId`, `startedAt`, `completedAt`, `durationMs`, `outcome`, and optional `error`.

**Throws:** `MechaError` with code `SCHEDULE_RUN_FAILED` if the runtime returns an error.

### `botScheduleHistory(pm, name, scheduleId, limit?)`

Retrieve the run history for a schedule entry, optionally limited to the most recent N runs.

```ts
import { botScheduleHistory } from "@mecha/service";

const history = await botScheduleHistory(pm, "researcher", "daily-summary", 10);
for (const run of history) {
  console.log(`${run.startedAt}: ${run.outcome} (${run.durationMs}ms)`);
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pm` | `ProcessManager` | Yes | Process manager instance |
| `name` | `BotName` | Yes | Bot name |
| `scheduleId` | `string` | Yes | Schedule entry ID |
| `limit` | `number` | No | Maximum number of history entries to return |

**Returns:** `Promise<ScheduleRunResult[]>`

**Throws:** `MechaError` with code `SCHEDULE_HISTORY_FAILED` if the runtime returns an error.

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
| _(none)_ | -- | -- | -- |

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

### `listBotDir(homeDir, relPath)`

List directory entries under a bot's home directory. Uses `lstat` to avoid following symlinks. Skips hidden entries (starting with `.`) and symlinks. Results are sorted with directories first, then alphabetically by name.

```ts
import { listBotDir } from "@mecha/service";

const entries = await listBotDir("/Users/you/.mecha/researcher", "notes");
// [
//   { name: "drafts", type: "directory", size: 128, modifiedAt: "2026-03-21T..." },
//   { name: "plan.md", type: "file", size: 2048, modifiedAt: "2026-03-21T..." },
// ]
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `homeDir` | `string` | Yes | Bot's effective home directory |
| `relPath` | `string` | Yes | Relative path within home (empty string for root) |

**Returns:** `Promise<DirEntry[]>` -- Empty array if the directory does not exist.

**Throws:** `PathTraversalError` if the path contains hidden segments or escapes the home directory.

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

- [@mecha/process](/reference/api/process) -- Process lifecycle management used by the service layer
- [@mecha/core](/reference/api/core) -- Types and schemas
- [@mecha/meter](/reference/api/meter) -- Metering integration
- [API Reference](/reference/api/) -- Route summary and package overview
