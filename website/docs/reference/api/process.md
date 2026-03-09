---
title: "@mecha/process"
description: API reference for @mecha/process — process lifecycle management, port allocation, sandbox setup, schedule persistence, and event emission.
---

# @mecha/process

The `@mecha/process` package manages bot process lifecycles: spawning, stopping, killing, port allocation, sandbox filesystem setup, schedule persistence, and event emission.

## Barrel Exports

The package re-exports the following public API:

| Export | Kind | Source |
|--------|------|--------|
| `checkPort` | Function | `port.ts` |
| `allocatePort` | Function | `port.ts` |
| `waitForHealthy` | Function | `health.ts` |
| `readState` | Function | `state-store.ts` |
| `writeState` | Function | `state-store.ts` |
| `listBotDirs` | Function | `state-store.ts` |
| `BotState` | Type | `state-store.ts` |
| `ProcessEventEmitter` | Class | `events.ts` |
| `ProcessEvent` | Type | `events.ts` |
| `ProcessEventHandler` | Type | `events.ts` |
| `createProcessManager` | Function | `process-manager.ts` |
| `ProcessManager` | Interface | `types.ts` |
| `ProcessInfo` | Interface | `types.ts` |
| `SpawnOpts` | Interface | `types.ts` |
| `LogOpts` | Interface | `types.ts` |
| `CreateProcessManagerOpts` | Interface | `types.ts` |
| `isPidAlive` | Function | `process-lifecycle.ts` (re-export from `@mecha/core`) |
| `waitForChildExit` | Function | `process-lifecycle.ts` |
| `waitForPidExit` | Function | `process-lifecycle.ts` |
| `prepareBotFilesystem` | Function | `sandbox-setup.ts` |
| `encodeProjectPath` | Function | `sandbox-setup.ts` |
| `buildBotEnv` | Function | `sandbox-setup.ts` |
| `BotFilesystemOpts` | Interface | `sandbox-setup.ts` |
| `BotFilesystemResult` | Interface | `sandbox-setup.ts` |
| `BuildBotEnvOpts` | Interface | `sandbox-setup.ts` |
| `readLogs` | Function | `log-reader.ts` |
| `MechaPty` | Interface | `pty-types.ts` |
| `PtySpawnOpts` | Interface | `pty-types.ts` |
| `PtySpawnFn` | Type | `pty-types.ts` |
| `PtyDisposable` | Interface | `pty-types.ts` |
| `createBunPtySpawn` | Function | `bun-pty.ts` |
| `readScheduleConfig` | Function | `schedule-store.ts` |
| `writeScheduleConfig` | Function | `schedule-store.ts` |
| `readScheduleState` | Function | `schedule-store.ts` |
| `writeScheduleState` | Function | `schedule-store.ts` |
| `appendRunHistory` | Function | `schedule-store.ts` |
| `readRunHistory` | Function | `schedule-store.ts` |
| `removeScheduleData` | Function | `schedule-store.ts` |

## `createProcessManager(opts)`

Factory function that creates a `ProcessManager` instance managing bot process lifecycles with per-bot mutex serialization.

```ts
import { createProcessManager } from "@mecha/process";

const pm = createProcessManager({
  mechaDir: "/Users/you/.mecha",
  runtimeEntrypoint: "/path/to/runtime.js",
  healthTimeoutMs: 30000,
});

const info = await pm.spawn({ name: "researcher", workspacePath: "/path/to/workspace" });
```

**`CreateProcessManagerOpts`**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `mechaDir` | `string` | Yes | — | Path to `~/.mecha` data directory |
| `healthTimeoutMs` | `number` | No | `10000` | Timeout for bot health check after spawn |
| `spawnFn` | `typeof spawn` | No | `child_process.spawn` | Override for testing |
| `runtimeEntrypoint` | `string` | No | — | Path to the `@mecha/runtime` JS entrypoint (used with `node`) |
| `runtimeBin` | `string` | No | — | Path to a standalone runtime binary (takes precedence over `runtimeEntrypoint`) |
| `runtimeArgs` | `string[]` | No | — | Extra args when using `runtimeBin` (e.g., `["__runtime"]`) |
| `sandbox` | `Sandbox` | No | — | Sandbox instance for kernel-level isolation |

**`ProcessManager` Interface**

| Method | Signature | Description |
|--------|-----------|-------------|
| `spawn` | `(opts: SpawnOpts) => Promise<ProcessInfo>` | Spawn a new bot process |
| `get` | `(name: BotName) => ProcessInfo \| undefined` | Get bot info by name |
| `list` | `() => ProcessInfo[]` | List all bots (checks PID liveness) |
| `stop` | `(name: BotName) => Promise<void>` | Graceful stop (SIGTERM, then SIGKILL after grace period) |
| `kill` | `(name: BotName) => Promise<void>` | Force kill (SIGKILL) |
| `logs` | `(name: BotName, opts?: LogOpts) => Readable` | Stream bot logs |
| `getPortAndToken` | `(name: BotName) => { port: number; token: string } \| undefined` | Get connection details for a running bot |
| `onEvent` | `(handler: (event: ProcessEvent) => void) => () => void` | Subscribe to lifecycle events (returns unsubscribe fn) |

## Types

### `SpawnOpts`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `BotName` | Yes | Bot name |
| `workspacePath` | `string` | Yes | Absolute path to workspace directory |
| `port` | `number` | No | Specific port (auto-allocated from 7700-7799 if omitted) |
| `env` | `Record<string, string>` | No | Additional environment variables |
| `model` | `string` | No | Model override |
| `permissionMode` | `string` | No | Permission mode |
| `auth` | `string \| null` | No | Auth profile name or `null` to clear |
| `tags` | `string[]` | No | Tags for discovery |
| `expose` | `string[]` | No | Exposed capabilities |
| `runtimeBin` | `string` | No | Per-spawn runtime binary override |
| `sandboxMode` | `SandboxMode` | No | Sandbox mode (`"auto"`, `"require"`, `"off"`) |
| `meterOff` | `boolean` | No | Disable metering for this bot |
| `home` | `string` | No | Override HOME directory |
| `systemPrompt` | `string` | No | System prompt override (mutually exclusive with `appendSystemPrompt`) |
| `appendSystemPrompt` | `string` | No | Append to default system prompt (mutually exclusive with `systemPrompt`) |
| `effort` | `"low" \| "medium" \| "high"` | No | Effort level for the LLM |
| `maxBudgetUsd` | `number` | No | Max USD budget per session |
| `allowedTools` | `string[]` | No | Allowed tools (mutually exclusive with `tools`) |
| `disallowedTools` | `string[]` | No | Disallowed tools |
| `tools` | `string[]` | No | Override tool set (mutually exclusive with `allowedTools`) |
| `addDirs` | `string[]` | No | Additional directories to mount |
| `agent` | `string` | No | Agent preset name |
| `agents` | `Record<string, { description: string; prompt: string }>` | No | Named agent definitions |
| `sessionPersistence` | `boolean` | No | Enable/disable session persistence |
| `mcpServers` | `Record<string, unknown>` | No | Inline MCP server definitions |
| `mcpConfigFiles` | `string[]` | No | MCP config file paths |
| `strictMcpConfig` | `boolean` | No | Only use specified MCP servers |
| `pluginDirs` | `string[]` | No | Plugin directories |
| `disableSlashCommands` | `boolean` | No | Disable all skills |
| `budgetLimit` | `number` | No | Mecha-level aggregate budget cap |

### `ProcessInfo`

| Field | Type | Description |
|-------|------|-------------|
| `name` | `BotName` | Bot name |
| `state` | `"running" \| "stopped" \| "error"` | Current state |
| `pid` | `number?` | OS process ID |
| `port` | `number?` | Listening port |
| `workspacePath` | `string` | Workspace path |
| `token` | `string?` | Auth token (only available for live processes) |
| `startedAt` | `string?` | ISO timestamp of last start |
| `stoppedAt` | `string?` | ISO timestamp of last stop |
| `exitCode` | `number?` | Exit code if stopped |

### `LogOpts`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `follow` | `boolean` | `false` | Tail the log file (like `tail -f`) |
| `tail` | `number` | — | Number of lines from the end |

### `LiveProcess` (internal)

| Field | Type | Description |
|-------|------|-------------|
| `child` | `ChildProcess` | Node.js child process handle |
| `port` | `number` | Allocated port |
| `token` | `string` | Auth token |
| `name` | `BotName` | Bot name |

## `spawnBot(ctx, spawnOpts)`

Low-level spawn pipeline called internally by `ProcessManager.spawn()`. Handles port allocation, filesystem preparation, sandbox wrapping, child process spawning, health check, and state persistence.

```ts
function spawnBot(ctx: SpawnContext, spawnOpts: SpawnOpts): Promise<ProcessInfo>
```

Throws `BotAlreadyExistsError` if the bot is already running, `ProcessSpawnError` on spawn failures.

## `prepareBotFilesystem(opts)`

Creates the sandboxed directory structure for a bot process, writes `config.json`, sandbox hook scripts, Claude Code credentials, and builds the child process environment.

```ts
function prepareBotFilesystem(opts: BotFilesystemOpts): BotFilesystemResult
```

**`BotFilesystemOpts`**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `botDir` | `string` | Yes | Bot root directory |
| `workspacePath` | `string` | Yes | Workspace path |
| `port` | `number` | Yes | Allocated port |
| `token` | `string` | Yes | Auth token |
| `name` | `string` | Yes | Bot name |
| `mechaDir` | `string` | Yes | Path to `~/.mecha` |
| `model` | `string` | No | Model override |
| `permissionMode` | `string` | No | Permission mode |
| `auth` | `string \| null` | No | Auth profile |
| `tags` | `string[]` | No | Tags |
| `expose` | `string[]` | No | Exposed capabilities |
| `userEnv` | `Record<string, string>` | No | User environment variables (reserved keys are filtered) |
| `meterOff` | `boolean` | No | Disable meter proxy integration |
| `home` | `string` | No | Override HOME directory |

**`BotFilesystemResult`**

| Field | Type | Description |
|-------|------|-------------|
| `homeDir` | `string` | Effective HOME directory |
| `tmpDir` | `string` | TMPDIR for the bot |
| `logsDir` | `string` | Log directory |
| `projectsDir` | `string` | Claude projects directory |
| `childEnv` | `Record<string, string>` | Complete environment for the child process |

The directory structure mirrors real Claude Code:

```
botDir/
  .claude/
    settings.json         <- hooks config
    hooks/
      sandbox-guard.sh    <- file access guard
      bash-guard.sh       <- bash command guard
    projects/<encoded>/   <- session data
  tmp/                    <- TMPDIR
  logs/                   <- stdout.log, stderr.log
  config.json             <- port, token, workspace
```

## `waitForChildExit(child, timeoutMs)`

Waits for a `ChildProcess` to emit an `exit` event within the given timeout.

```ts
function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean>
```

Returns `true` if the child exited, `false` if the timeout elapsed.

## `waitForPidExit(pid, timeoutMs)`

Polls a process by PID (using `process.kill(pid, 0)`) until it exits or the timeout elapses. Polls every 100ms.

```ts
function waitForPidExit(pid: number, timeoutMs: number): Promise<boolean>
```

Returns `true` if the process exited, `false` on timeout.

## Process Events

**`ProcessEvent`** -- Discriminated union of lifecycle events:

| Event | Fields | Description |
|-------|--------|-------------|
| `spawned` | `name`, `pid`, `port` | Bot process started successfully |
| `stopped` | `name`, `exitCode?` | Bot process exited |
| `error` | `name`, `error` | Bot encountered an error |
| `warning` | `name`, `message` | Non-fatal warning (e.g., sandbox degradation) |

**`ProcessEventEmitter`** -- Simple typed event emitter class:

| Member | Description |
|--------|-------------|
| `subscribe(handler)` | Register a handler. Returns an unsubscribe function |
| `emit(event)` | Emit an event to all handlers. Failures are isolated per handler |
| `listenerCount` | Read-only property returning the number of active handlers |

## Schedule Store

Filesystem-backed persistence for bot schedules. All writes use atomic tmp+rename.

### `readScheduleConfig(botDir)`

Reads `schedule.json` from the bot directory. Returns an empty config (`{ schedules: [] }`) if the file is missing or corrupt.

```ts
function readScheduleConfig(botDir: string): ScheduleConfig
```

### `writeScheduleConfig(botDir, config)`

Atomically writes `schedule.json` to the bot directory.

```ts
function writeScheduleConfig(botDir: string, config: ScheduleConfig): void
```

### `readScheduleState(botDir, scheduleId)`

Reads per-schedule state from `schedules/<id>/state.json`. Returns `undefined` if missing.

```ts
function readScheduleState(botDir: string, scheduleId: string): ScheduleState | undefined
```

### `writeScheduleState(botDir, scheduleId, state)`

Atomically writes per-schedule state.

```ts
function writeScheduleState(botDir: string, scheduleId: string, state: ScheduleState): void
```

### `appendRunHistory(botDir, scheduleId, result)`

Appends a run result to `schedules/<id>/history.jsonl`. Automatically truncates when the file exceeds `MAX_HISTORY_ENTRIES` (amortized check based on file size heuristic).

```ts
function appendRunHistory(botDir: string, scheduleId: string, result: ScheduleRunResult): void
```

### `readRunHistory(botDir, scheduleId, limit?)`

Reads run history from the JSONL file. Malformed lines are silently skipped. When `limit` is provided, returns only the most recent N entries.

```ts
function readRunHistory(botDir: string, scheduleId: string, limit?: number): ScheduleRunResult[]
```

### `removeScheduleData(botDir, scheduleId)`

Removes all state and history for a schedule (deletes `schedules/<id>/` recursively).

```ts
function removeScheduleData(botDir: string, scheduleId: string): void
```

## See also

- [@mecha/core](/reference/api/core) — Types and schemas used by the process package
- [@mecha/runtime](/reference/api/runtime) — Per-bot Fastify server that runs inside spawned processes
- [@mecha/service](/reference/api/service) — High-level API that wraps process management
- [API Reference](/reference/api/) — Route summary and package overview
