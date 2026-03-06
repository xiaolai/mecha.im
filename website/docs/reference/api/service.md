---
title: "@mecha/service"
description: API reference for @mecha/service — high-level business logic layer for bot operations, routing, auth, scheduling, and node management.
---

# @mecha/service

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
| `ChatEvent` | Type | `chat.ts` |
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

## `botStatus(pm, name)`

Returns the current status of a bot by name. Reads live state from the process manager and on-disk state.

```ts
import { botStatus } from "@mecha/service";

const info = await botStatus(pm, "researcher");
// { name: "researcher", state: "running", pid: 12345, port: 7700, ... }
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pm` | `ProcessManager` | Yes | Process manager instance |
| `name` | `string` | Yes | Bot name |

Returns `ProcessInfo` or `undefined` if the bot doesn't exist.

## `botFind(pm, opts)`

Find bots matching filter criteria (tag, state).

```ts
import { botFind } from "@mecha/service";

const results = await botFind(pm, { tag: "dev" });
// [{ name: "coder", tags: ["dev", "backend"], ... }]
```

**`FindResult`** — Array of matching bots with name, tags, state, port, and workspace.

## `botChat(pm, opts)`

Send a message to a bot and stream the response. Returns an async iterable of `ChatEvent` objects.

```ts
import { botChat } from "@mecha/service";

for await (const event of botChat(pm, { name: "coder", message: "Explain this function" })) {
  if (event.type === "text") process.stdout.write(event.text);
}
```

**`ChatOpts`**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Bot name |
| `message` | `string` | Yes | Message to send |
| `session` | `string` | No | Session ID (creates new if omitted) |

**`ChatEvent`** — Discriminated union: `{ type: "text", text }`, `{ type: "tool_use", name, input }`, `{ type: "done" }`.

## `mechaInit(mechaDir)`

Initialize Mecha data directory at `~/.mecha/`. Creates directory structure, generates TOTP secret, and writes default configuration.

```ts
import { mechaInit } from "@mecha/service";

const result = await mechaInit("/Users/you/.mecha");
// { created: true, totpSecret: "...", mechaDir: "/Users/you/.mecha" }
```

**`InitResult`** — `{ created: boolean, totpSecret?: string, mechaDir: string }`

## `mechaDoctor(mechaDir, pm)`

Run system health checks. Returns a list of checks with pass/fail status.

```ts
import { mechaDoctor } from "@mecha/service";

const result = await mechaDoctor("/Users/you/.mecha", pm);
for (const check of result.checks) {
  console.log(`${check.ok ? "✓" : "✗"} ${check.label}`);
}
```

**`DoctorCheck`** — `{ label: string, ok: boolean, detail?: string }`

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

## See also

- [@mecha/process](/reference/api/process) — Process lifecycle management used by the service layer
- [@mecha/core](/reference/api/core) — Types and schemas
- [@mecha/meter](/reference/api/meter) — Metering integration
- [API Reference](/reference/api/) — Route summary and package overview
