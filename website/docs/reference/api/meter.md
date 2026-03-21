---
title: "@mecha/meter"
description: API reference for @mecha/meter — metering proxy, cost tracking, budgets, rollups, events, pricing, and hot counters.
---

# @mecha/meter

[[toc]]

The `@mecha/meter` package provides the metering proxy that tracks API costs per agent in real time, with budgets, rollups, and event persistence.

## Daemon

### `startDaemon(opts)`

Start the metering proxy daemon. Throws if already running or port is busy.

```ts
function startDaemon(opts: DaemonOpts): Promise<DaemonHandle>
```

| Param | Type | Description |
|-------|------|-------------|
| `opts.meterDir` | `string` | Path to the meter data directory |
| `opts.mechaDir` | `string?` | Path to the parent mecha directory (defaults to `meterDir/..`) |
| `opts.port` | `number` | Port to listen on (use `0` for auto-assign) |
| `opts.required` | `boolean` | Whether the meter is required for bot operation |
| `opts.authToken` | `string?` | Bearer token for proxy auth; if set, all requests must include `Authorization` header |

**Returns:** `DaemonHandle` with `server`, `info`, and `close()`.

### `stopDaemon(meterDir)`

Stop a running proxy by sending SIGTERM.

```ts
function stopDaemon(meterDir: string): boolean
```

Returns `true` if the signal was sent, `false` if the proxy was not running.

### `meterDir(mechaDir)`

Get the meter directory path (`<mechaDir>/meter`).

```ts
function meterDir(mechaDir: string): string
```

## Proxy

### `handleProxyRequest(req, res, ctx)`

Handle an incoming proxied HTTP request. Parses the bot name from the URL path (`/bot/{name}/...`), enforces budgets, forwards to `api.anthropic.com`, records the meter event, and streams the response back.

```ts
function handleProxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ProxyContext,
): void
```

### `parseBotPath(url)`

Parse the bot name and upstream path from a request URL.

```ts
function parseBotPath(url: string): { bot: string; upstreamPath: string } | null
```

Returns `null` if the URL does not match `/bot/{name}/...`.

### `buildUpstreamHeaders(incoming)`

Build upstream request headers: sets `Host: api.anthropic.com` and strips hop-by-hop headers per RFC 7230.

```ts
function buildUpstreamHeaders(
  incoming: Record<string, string | string[] | undefined>,
): Record<string, string>
```

### `buildMeterEvent(ctx, startMs, bot, botInfo, model, stream, status, usage)`

Build a `MeterEvent` from proxy usage data, computing the USD cost from the pricing table.

```ts
function buildMeterEvent(
  ctx: ProxyContext,
  startMs: number,
  bot: string,
  botInfo: BotRegistryEntry,
  model: string,
  stream: boolean,
  status: number,
  usage: ExtractedUsage,
): MeterEvent
```

### `enforceBudget(ctx, bot, botInfo)`

Check all applicable budgets (global, per-bot, per-auth, per-tag) for a request. Adds estimated cost for in-flight requests to prevent concurrent budget bypass.

```ts
function enforceBudget(
  ctx: ProxyContext,
  bot: string,
  botInfo: BotRegistryEntry,
): BudgetCheckResult
```

### `reloadBudgets(ctx)`

Reload budgets from disk into the proxy context. Called on `SIGHUP`.

```ts
function reloadBudgets(ctx: ProxyContext): void
```

### `recordEvent(ctx, event)`

Append a meter event to disk and update hot counters. If the disk write fails, the event is dropped and the counter is incremented (visible in `snapshot.droppedEvents`).

```ts
function recordEvent(ctx: ProxyContext, event: MeterEvent): void
```

## SSE Stream Parsing

### `createSSEParseState(requestStartMs, model)`

Create initial state for incremental SSE stream parsing.

```ts
function createSSEParseState(requestStartMs: number, model: string): SSEParseState
```

### `parseSSEChunk(chunk, state)`

Parse SSE data lines from a text chunk and accumulate usage into the state object. Handles `message_start` (input tokens, cache tokens, model), `content_block_delta` (time-to-first-token), and `message_delta` (output tokens) events.

```ts
function parseSSEChunk(chunk: string, state: SSEParseState): void
```

### `extractNonStreamUsage(body)`

Extract usage from a non-streaming JSON response body.

```ts
function extractNonStreamUsage(body: string): ExtractedUsage
```

## Rollups

### Path Functions

```ts
function hourlyRollupPath(meterDir: string, date: string): string
function dailyRollupPath(meterDir: string, month: string): string
function botRollupPath(meterDir: string, bot: string): string
```

Return the filesystem path for each rollup type. Path segments are validated against strict patterns (`YYYY-MM-DD`, `YYYY-MM`, `[a-z0-9-]+`).

### Read Functions

```ts
function readHourlyRollup(meterDir: string, date: string): HourlyRollup
function readDailyRollup(meterDir: string, month: string): DailyRollup
function readBotRollup(meterDir: string, bot: string): BotRollup
```

Read a rollup from disk. Returns an empty rollup structure if the file is missing or corrupt.

### Write Functions

```ts
function writeHourlyRollup(meterDir: string, rollup: HourlyRollup): void
function writeDailyRollup(meterDir: string, rollup: DailyRollup): void
function writeBotRollup(meterDir: string, rollup: BotRollup): void
```

Write a rollup to disk atomically (temp file + rename).

### Update Functions

```ts
function updateHourlyRollup(rollup: HourlyRollup, event: MeterEvent): void
function updateDailyRollup(rollup: DailyRollup, event: MeterEvent, date: string): void
function updateBotRollup(rollup: BotRollup, event: MeterEvent, date: string): void
```

Incrementally update a rollup in memory with a new event. Creates new time buckets as needed.

### `flushRollups(meterDir, hourly, daily, bot)`

Write all in-memory rollups to disk.

```ts
function flushRollups(
  meterDir: string,
  hourly: Map<string, HourlyRollup>,
  daily: Map<string, DailyRollup>,
  bot: Map<string, BotRollup>,
): void
```

## Events

### `appendEvent(meterDir, event)`

Append a `MeterEvent` to the day's JSONL file (`events/YYYY-MM-DD.jsonl`).

```ts
function appendEvent(meterDir: string, event: MeterEvent): void
```

### `readEventsForDate(meterDir, date)`

Read all events for a specific UTC date. Skips malformed lines.

```ts
function readEventsForDate(meterDir: string, date: string): MeterEvent[]
```

### `listEventDates(meterDir)`

List available event dates (`YYYY-MM-DD`) sorted ascending.

```ts
function listEventDates(meterDir: string): string[]
```

### `eventsDir(meterDir)`

Return the path to the events directory (`<meterDir>/events`).

```ts
function eventsDir(meterDir: string): string
```

### `utcDate(ts)`

Extract the UTC date string (`YYYY-MM-DD`) from an ISO timestamp.

```ts
function utcDate(ts: string): string
```

## Query

### `queryCostToday(meterDir)`

Query cost from raw event files for today.

```ts
function queryCostToday(meterDir: string): CostQueryResult
```

### `queryCostForBot(meterDir, bot)`

Query cost from raw event files for a specific bot today.

```ts
function queryCostForBot(meterDir: string, bot: string): CostQueryResult
```

### `aggregateEvents(events, period)`

Aggregate a list of events into a `CostQueryResult` with total and per-bot breakdowns.

```ts
function aggregateEvents(events: MeterEvent[], period: string): CostQueryResult
```

### `emptySummary()`

Create an empty `CostSummary` with all fields zeroed.

```ts
function emptySummary(): CostSummary
```

### `accumulateEvent(summary, event)`

Accumulate an event's tokens, cost, and latency into a `CostSummary`. Uses a running average for latency.

```ts
function accumulateEvent(summary: CostSummary, event: MeterEvent): void
```

### `todayUTC()`

Return today's date as a `YYYY-MM-DD` string in UTC.

```ts
function todayUTC(): string
```

## Pricing

### `loadPricing(meterDir)`

Load the pricing table from `<meterDir>/pricing.json`. Falls back to `DEFAULT_PRICING` on error.

```ts
function loadPricing(meterDir: string): PricingTable
```

### `initPricing(meterDir)`

Write `pricing.json` with default rates if it does not exist.

```ts
function initPricing(meterDir: string): void
```

### `computeCost(pricing, tokens)`

Compute USD cost from token counts and per-million pricing rates.

```ts
function computeCost(
  pricing: ModelPricing,
  tokens: { inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number },
): number
```

### `resolvePricing(table, model)`

Look up pricing for a model. Falls back to the most expensive model in the table if unknown.

```ts
function resolvePricing(table: PricingTable, model: string): ModelPricing
```

### `getFallbackPricing(table)`

Return the most expensive model pricing in the table (used as fallback for unknown models).

```ts
function getFallbackPricing(table: PricingTable): ModelPricing
```

### `DEFAULT_PRICING`

Hardcoded default pricing table with rates for `claude-opus-4-6`, `claude-sonnet-4-6`, and `claude-haiku-4-5`.

## Lifecycle

### `readProxyInfo(meterDir)`

Read `proxy.json`. Returns `null` if the file is missing or corrupt.

```ts
function readProxyInfo(meterDir: string): ProxyInfo | null
```

### `writeProxyInfo(meterDir, info)`

Write `proxy.json` atomically (temp file + rename).

```ts
function writeProxyInfo(meterDir: string, info: ProxyInfo): void
```

### `deleteProxyInfo(meterDir)`

Delete `proxy.json`. Silently ignores `ENOENT`.

```ts
function deleteProxyInfo(meterDir: string): void
```

### `isPidAlive(pid)`

Check whether a process with the given PID is alive.

```ts
function isPidAlive(pid: number): boolean
```

### `cleanStaleProxy(meterDir)`

Remove `proxy.json` if the recorded PID is dead. Returns `true` if cleaned.

```ts
function cleanStaleProxy(meterDir: string): boolean
```

### `getMeterStatus(meterDir)`

Get the current meter proxy status.

```ts
function getMeterStatus(meterDir: string): MeterStatus
```

## Registry

### `scanBotRegistry(mechaDir)`

Scan subdirectories of `mechaDir` for `config.json` files to build the bot registry.

```ts
function scanBotRegistry(mechaDir: string): Map<string, BotRegistryEntry>
```

### `lookupBot(registry, name)`

Look up a bot in the registry. Returns default values (`authProfile: "unknown"`, `workspace: "unknown"`, `tags: []`) for unregistered bots.

```ts
function lookupBot(registry: Map<string, BotRegistryEntry>, name: string): BotRegistryEntry
```

## Hot Counters

### `createHotCounters(date)`

Create empty hot counters for a given UTC date.

```ts
function createHotCounters(date: string): HotCounters
```

### `ingestEvent(counters, event)`

Ingest an event into hot counters (global, per-bot, per-auth, per-tag for both today and this month).

```ts
function ingestEvent(counters: HotCounters, event: MeterEvent): void
```

### `resetToday(counters, newDate)`

Reset daily counters to zero at UTC midnight. Prunes inactive buckets that have no monthly activity.

```ts
function resetToday(counters: HotCounters, newDate: string): void
```

### `toSnapshot(counters)` / `fromSnapshot(snapshot)`

Convert between hot counters and the `HotSnapshot` format for persistence.

```ts
function toSnapshot(counters: HotCounters): HotSnapshot
function fromSnapshot(snapshot: HotSnapshot): HotCounters
```

## Snapshot

### `snapshotPath(meterDir)`

Return the path to `snapshot.json`.

```ts
function snapshotPath(meterDir: string): string
```

### `readSnapshot(meterDir)`

Read the snapshot from disk. Returns `null` if missing or corrupt.

```ts
function readSnapshot(meterDir: string): HotSnapshot | null
```

### `writeSnapshot(meterDir, snapshot)`

Write the snapshot to disk atomically.

```ts
function writeSnapshot(meterDir: string, snapshot: HotSnapshot): void
```

## Budgets

### `budgetsPath(meterDir)`

Return the path to `budgets.json`.

```ts
function budgetsPath(meterDir: string): string
```

### `readBudgets(meterDir)`

Read budgets from disk. Returns an empty config if the file is missing or corrupt.

```ts
function readBudgets(meterDir: string): BudgetConfig
```

### `writeBudgets(meterDir, config)`

Write budgets to disk.

```ts
function writeBudgets(meterDir: string, config: BudgetConfig): void
```

### `checkBudgets(input)`

Check all applicable budgets for a request. Returns whether the request is allowed, any 80% warnings, and the exceeded message if blocked.

```ts
function checkBudgets(input: BudgetCheckInput): BudgetCheckResult
```

### `setBudget(config, target, daily?, monthly?)`

Set a budget for a target (global, bot, auth profile, or tag).

```ts
function setBudget(config: BudgetConfig, target: BudgetTarget, daily?: number, monthly?: number): void
```

### `removeBudget(config, target, field)`

Remove a daily or monthly budget limit. Returns `true` if a limit was removed.

```ts
function removeBudget(config: BudgetConfig, target: BudgetTarget, field: "daily" | "monthly"): boolean
```

## Utility

### `ulid(now?)`

Generate a ULID (Universally Unique Lexicographically Sortable Identifier). Uses `Date.now()` by default.

```ts
function ulid(now?: number): string
```

## Type Reference

### `MeterEvent`

A single metered API call event.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | ULID (time-sortable unique ID) |
| `ts` | `string` | ISO-8601 timestamp of request completion |
| `bot` | `string` | Bot name |
| `authProfile` | `string` | Auth profile used |
| `workspace` | `string` | Workspace path |
| `tags` | `string[]` | Bot tags |
| `model` | `string` | Requested model |
| `stream` | `boolean` | Whether the request used streaming |
| `status` | `number` | HTTP status code (`200`, `4xx`, `5xx`), `0` = unreachable, `-1` = client disconnect |
| `modelActual` | `string` | Actual model returned by API |
| `latencyMs` | `number` | Total request latency in milliseconds |
| `ttftMs` | `number \| null` | Time to first token (streaming only) |
| `inputTokens` | `number` | Input tokens consumed |
| `outputTokens` | `number` | Output tokens generated |
| `cacheCreationTokens` | `number` | Cache creation input tokens |
| `cacheReadTokens` | `number` | Cache read input tokens |
| `costUsd` | `number` | Computed cost in USD |

### `CostSummary`

Aggregated cost and usage summary.

| Field | Type | Description |
|-------|------|-------------|
| `requests` | `number` | Total number of requests |
| `errors` | `number` | Number of non-200 responses |
| `inputTokens` | `number` | Total input tokens |
| `outputTokens` | `number` | Total output tokens |
| `cacheCreationTokens` | `number` | Total cache creation tokens |
| `cacheReadTokens` | `number` | Total cache read tokens |
| `costUsd` | `number` | Total cost in USD |
| `avgLatencyMs` | `number` | Running average latency in milliseconds |

### `HotCounterBuckets`

In-memory counter structure for budget enforcement and snapshots.

| Field | Type | Description |
|-------|------|-------------|
| `date` | `string` | Current UTC date (`YYYY-MM-DD`) |
| `global` | `{ today: CostSummary; thisMonth: CostSummary }` | Global totals |
| `byBot` | `Record<string, { today: CostSummary; thisMonth: CostSummary }>` | Per-bot counters |
| `byAuth` | `Record<string, { today: CostSummary; thisMonth: CostSummary }>` | Per-auth-profile counters |
| `byTag` | `Record<string, { today: CostSummary; thisMonth: CostSummary }>` | Per-tag counters |

### `HotSnapshot`

Extends `HotCounterBuckets` with a timestamp for persistence.

| Field | Type | Description |
|-------|------|-------------|
| `ts` | `string` | ISO-8601 snapshot timestamp |
| `droppedEvents` | `number?` | Number of events that failed to persist since process start |
| *(all fields from `HotCounterBuckets`)* | | |

### `ModelPricing`

Per-million token pricing for a single model.

| Field | Type | Description |
|-------|------|-------------|
| `inputPerMillion` | `number` | USD per million input tokens |
| `outputPerMillion` | `number` | USD per million output tokens |
| `cacheCreationPerMillion` | `number` | USD per million cache creation tokens |
| `cacheReadPerMillion` | `number` | USD per million cache read tokens |

### `PricingTable`

Complete pricing configuration.

| Field | Type | Description |
|-------|------|-------------|
| `version` | `number` | Schema version |
| `updatedAt` | `string` | ISO-8601 timestamp of last update |
| `models` | `Record<string, ModelPricing>` | Pricing keyed by model name |

### `ProxyInfo`

Runtime state of the meter proxy process, persisted to `proxy.json`.

| Field | Type | Description |
|-------|------|-------------|
| `port` | `number` | Listening port |
| `pid` | `number` | Process ID |
| `required` | `boolean` | Whether the meter is required for bot operation |
| `startedAt` | `string` | ISO-8601 start timestamp |

### `BudgetLimit`

Spending limits for a single target.

| Field | Type | Description |
|-------|------|-------------|
| `dailyUsd` | `number?` | Daily spending cap in USD |
| `monthlyUsd` | `number?` | Monthly spending cap in USD |

### `BudgetConfig`

Complete budget configuration, persisted to `budgets.json`.

| Field | Type | Description |
|-------|------|-------------|
| `global` | `BudgetLimit` | Global spending limits |
| `byBot` | `Record<string, BudgetLimit>` | Per-bot limits |
| `byAuthProfile` | `Record<string, BudgetLimit>` | Per-auth-profile limits |
| `byTag` | `Record<string, BudgetLimit>` | Per-tag limits |

### `HourlyRollup`

Hourly cost breakdown for a single date.

| Field | Type | Description |
|-------|------|-------------|
| `date` | `string` | UTC date (`YYYY-MM-DD`) |
| `hours` | `Array<{ hour, total, byBot, byModel }>` | Per-hour buckets (0-23) |
| `hours[].hour` | `number` | UTC hour (0-23) |
| `hours[].total` | `CostSummary` | Hour total |
| `hours[].byBot` | `Record<string, CostSummary>` | Per-bot breakdown |
| `hours[].byModel` | `Record<string, CostSummary>` | Per-model breakdown |

### `DailyRollup`

Daily cost breakdown for a single month.

| Field | Type | Description |
|-------|------|-------------|
| `month` | `string` | UTC month (`YYYY-MM`) |
| `days` | `Array<{ date, total, byBot, byModel, byAuthProfile, byTag, byWorkspace }>` | Per-day entries |
| `days[].date` | `string` | UTC date (`YYYY-MM-DD`) |
| `days[].total` | `CostSummary` | Day total |
| `days[].byBot` | `Record<string, CostSummary>` | Per-bot breakdown |
| `days[].byModel` | `Record<string, CostSummary>` | Per-model breakdown |
| `days[].byAuthProfile` | `Record<string, CostSummary>` | Per-auth-profile breakdown |
| `days[].byTag` | `Record<string, CostSummary>` | Per-tag breakdown |
| `days[].byWorkspace` | `Record<string, CostSummary>` | Per-workspace breakdown |

### `BotRollup`

All-time cost breakdown for a single bot.

| Field | Type | Description |
|-------|------|-------------|
| `bot` | `string` | Bot name |
| `allTime` | `CostSummary` | Lifetime totals |
| `byModel` | `Record<string, CostSummary>` | Per-model breakdown |
| `byDay` | `Array<{ date: string; summary: CostSummary }>` | Daily history |

### `BotRegistryEntry`

Bot identity as resolved from its `config.json`.

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Bot name (directory name) |
| `authProfile` | `string` | Auth profile identifier |
| `workspace` | `string` | Workspace path |
| `tags` | `string[]` | Bot tags |

### `ExtractedUsage`

Token usage extracted from an API response (streaming or non-streaming).

| Field | Type | Description |
|-------|------|-------------|
| `inputTokens` | `number` | Input tokens consumed |
| `outputTokens` | `number` | Output tokens generated |
| `cacheCreationTokens` | `number` | Cache creation input tokens |
| `cacheReadTokens` | `number` | Cache read input tokens |
| `modelActual` | `string` | Actual model returned by API |
| `ttftMs` | `number \| null` | Time to first token (streaming only) |

### `SSEParseState`

Mutable state object for incremental SSE stream parsing.

| Field | Type | Description |
|-------|------|-------------|
| `inputTokens` | `number` | Accumulated input tokens |
| `outputTokens` | `number` | Accumulated output tokens |
| `cacheCreationTokens` | `number` | Accumulated cache creation tokens |
| `cacheReadTokens` | `number` | Accumulated cache read tokens |
| `modelActual` | `string` | Model name from `message_start` |
| `ttftMs` | `number \| null` | Time to first content delta |
| `requestStartMs` | `number` | Request start timestamp (ms) |

### `ProxyContext`

Runtime context passed to all proxy handler functions.

| Field | Type | Description |
|-------|------|-------------|
| `meterDir` | `string` | Path to meter data directory |
| `pricing` | `PricingTable` | Loaded pricing table |
| `registry` | `Map<string, BotRegistryEntry>` | Bot registry |
| `counters` | `HotCounters` | In-memory hot counters |
| `budgets` | `BudgetConfig` | Loaded budget configuration |
| `pendingRequests` | `Map<string, number>` | In-flight request count per bot |

### `DaemonOpts`

Options for `startDaemon()`.

| Field | Type | Description |
|-------|------|-------------|
| `meterDir` | `string` | Path to meter data directory |
| `mechaDir` | `string?` | Parent mecha directory (defaults to `meterDir/..`) |
| `port` | `number` | Port to listen on |
| `required` | `boolean` | Whether the meter is required |
| `authToken` | `string?` | Bearer token for proxy auth |

### `DaemonHandle`

Handle returned by `startDaemon()`.

| Field | Type | Description |
|-------|------|-------------|
| `server` | `Server` | Node.js HTTP server instance |
| `info` | `ProxyInfo` | Proxy runtime info (port, pid, startedAt) |
| `close` | `() => Promise<void>` | Graceful shutdown (flushes snapshot, closes server, deletes `proxy.json`) |

### `MeterStatus`

Status snapshot returned by `getMeterStatus()`.

| Field | Type | Description |
|-------|------|-------------|
| `running` | `boolean` | Whether the proxy is running |
| `port` | `number?` | Listening port (only if running) |
| `pid` | `number?` | Process ID (only if running) |
| `required` | `boolean?` | Whether the meter is required (only if running) |
| `startedAt` | `string?` | ISO-8601 start time (only if running) |

### `CostQueryResult`

Result from cost query functions.

| Field | Type | Description |
|-------|------|-------------|
| `period` | `string` | Human-readable period label |
| `total` | `CostSummary` | Aggregate totals |
| `byBot` | `Record<string, CostSummary>` | Per-bot breakdown |

### `BudgetCheckResult`

Result from `checkBudgets()` or `enforceBudget()`.

| Field | Type | Description |
|-------|------|-------------|
| `allowed` | `boolean` | Whether the request is allowed |
| `warnings` | `string[]` | 80% threshold warning messages |
| `exceeded` | `string \| null` | 100% exceeded message (request blocked) |

### `BudgetCheckInput`

Input for `checkBudgets()`.

| Field | Type | Description |
|-------|------|-------------|
| `config` | `BudgetConfig` | Budget configuration |
| `bot` | `string` | Bot name |
| `authProfile` | `string` | Auth profile |
| `tags` | `string[]` | Bot tags |
| `global` | `{ today: CostSummary; month: CostSummary }` | Global counters |
| `perBot` | `{ today: CostSummary; month: CostSummary }?` | Per-bot counters |
| `perAuth` | `{ today: CostSummary; month: CostSummary }?` | Per-auth counters |
| `perTag` | `Record<string, { today: CostSummary; month: CostSummary }>` | Per-tag counters |
| `pendingCostUsd` | `number?` | Estimated cost of in-flight requests |

### `HotCounters`

Type alias for `HotCounterBuckets`. Used as the runtime in-memory counter structure.

## See also

- [Metering & Budgets](/features/metering) — User guide for metering and budget configuration
- [@mecha/core](/reference/api/core) — Shared types and utilities
- [API Reference](/reference/api/) — Route summary and package overview
