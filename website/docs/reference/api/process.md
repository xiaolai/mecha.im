---
title: "@mecha/process"
description: API reference for @mecha/process — process lifecycle management, port allocation, sandbox setup, schedule persistence, and event emission.
---

# @mecha/process

[[toc]]

The `@mecha/process` package manages bot process lifecycles: spawning, stopping, killing, port allocation, sandbox filesystem setup, schedule persistence, and event emission.

## Barrel Exports

The package re-exports the following public API:

| Export | Kind | Source |
|--------|------|--------|
| `checkPort` | Function | `port.ts` |
| `claimPort` | Function | `port.ts` |
| `allocatePort` | Function | `port.ts` |
| `PortClaim` | Interface | `port.ts` |
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
| `waitForPortFree` | Function | `process-lifecycle.ts` |
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
| `createNodePtySpawn` | Function | `node-pty-adapter.ts` |
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
| `disableSlashCommands` | `boolean` | No | Disable all skills |
| `budgetLimit` | `number` | No | Mecha-level aggregate budget cap |
| `dangerouslySkipPermissions` | `boolean` | No | Skip all permission prompts (requires `sandboxMode: "require"`) |
| `allowDangerouslySkipPermissions` | `boolean` | No | Allow the bot to self-escalate to skip permissions |
| `fallbackModel` | `string` | No | Fallback model when primary is unavailable |

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
| `systemPrompt` | `string` | No | Full system prompt override (mutually exclusive with `appendSystemPrompt`) |
| `appendSystemPrompt` | `string` | No | Append to default system prompt (mutually exclusive with `systemPrompt`) |
| `effort` | `"low" \| "medium" \| "high"` | No | LLM effort level |
| `maxBudgetUsd` | `number` | No | Maximum budget in USD |
| `allowedTools` | `string[]` | No | Additive tool filter (mutually exclusive with `tools`) |
| `disallowedTools` | `string[]` | No | Subtractive tool filter (mutually exclusive with `tools`) |
| `tools` | `string[]` | No | Full tool override (mutually exclusive with `allowedTools` and `disallowedTools`) |
| `agent` | `string` | No | Agent identity name |
| `agents` | `Record<string, { description, prompt }>` | No | Named agent definitions |
| `sessionPersistence` | `boolean` | No | Enable session persistence |
| `budgetLimit` | `number` | No | Budget limit per session |
| `mcpServers` | `Record<string, unknown>` | No | MCP servers to connect to |
| `mcpConfigFiles` | `string[]` | No | Paths to MCP config files |
| `strictMcpConfig` | `boolean` | No | Strict MCP configuration mode |
| `disableSlashCommands` | `boolean` | No | Disable slash commands |
| `dangerouslySkipPermissions` | `boolean` | No | Skip permission prompts (requires `sandboxMode: "require"`) |
| `allowDangerouslySkipPermissions` | `boolean` | No | Allow the dangerous skip permissions flag |
| `fallbackModel` | `string` | No | Fallback model if primary is unavailable |
| `addDirs` | `string[]` | No | Additional directories to mount in sandbox |

**`BotFilesystemResult`**

| Field | Type | Description |
|-------|------|-------------|
| `homeDir` | `string` | Effective HOME directory |
| `tmpDir` | `string` | TMPDIR for the bot |
| `logsDir` | `string` | Log directory |
| `projectsDir` | `string` | Claude projects directory |
| `childEnv` | `Record<string, string>` | Complete environment for the child process |

The directory structure mirrors real Claude Code:

```text
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

## `encodeProjectPath(workspacePath)`

Encodes a workspace path into a directory name matching Claude Code's convention. Replaces `/`, `\`, `:`, and `.` with `-`. Used internally by `prepareBotFilesystem` to build the per-workspace session directory path under `.claude/projects/`.

```ts
import { encodeProjectPath } from "@mecha/process";

encodeProjectPath("/home/user/my.project");
// => "-home-user-my-project"

encodeProjectPath("C:\\Users\\user\\project");
// => "C-Users-user-project"

encodeProjectPath("/Users/you/workspace");
// => "-Users-you-workspace"
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `workspacePath` | `string` | Absolute path to the workspace directory |

Returns `string` -- the encoded path with all `/`, `\`, `:`, and `.` characters replaced by `-`.

## `buildBotEnv(opts)`

Single source of truth for constructing the environment variable map passed to bot child processes and PTY sessions. Called by both `prepareBotFilesystem` (at spawn time) and the PTY manager (at terminal attach time) to ensure consistent environments.

Responsibilities:
- Constructs a minimal, safe `PATH` (Node.js binary dir + standard system paths; platform-aware for macOS and Windows)
- Filters user-supplied env vars through a reserved-key blocklist (case-insensitive) to prevent overriding internal vars, auth keys, `PATH`, and dangerous Node.js/linker variables
- Resolves the auth profile via `resolveAuth()` and injects the appropriate SDK credential (`ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`)
- Falls back to inheriting host credentials when no auth profiles exist and `auth` is not explicitly set
- Fails fast with `ProcessSpawnError` if no API credentials are available from any source (unless `auth` is explicitly `null`)
- Resolves the `claude` CLI binary path in the parent process (cached per process) and passes it as `MECHA_CLAUDE_PATH`
- Integrates with the meter proxy: reads `proxy.json`, verifies the proxy PID is alive and the port is reachable, then sets `ANTHROPIC_BASE_URL` to route API traffic through the metering proxy; throws `MeterProxyRequiredError` if the proxy is required but unreachable

```ts
import { buildBotEnv } from "@mecha/process";

const env = buildBotEnv({
  botDir: "/Users/you/.mecha/bots/researcher",
  homeDir: "/Users/you/.mecha/bots/researcher",
  tmpDir: "/Users/you/.mecha/bots/researcher/tmp",
  logsDir: "/Users/you/.mecha/bots/researcher/logs",
  projectsDir: "/Users/you/.mecha/bots/researcher/.claude/projects/-Users-you-workspace",
  workspacePath: "/Users/you/workspace",
  port: 7700,
  token: "bot-auth-token",
  name: "researcher",
  mechaDir: "/Users/you/.mecha",
  auth: "default",
  userEnv: { CUSTOM_VAR: "value" },
  meterOff: false,
});

// env is a Record<string, string> ready to pass to child_process.spawn or PTY
```

**`BuildBotEnvOpts`**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `botDir` | `string` | Yes | -- | Bot root directory (used as `MECHA_SANDBOX_ROOT`) |
| `homeDir` | `string` | Yes | -- | Effective HOME directory for the bot |
| `tmpDir` | `string` | Yes | -- | TMPDIR for the bot |
| `logsDir` | `string` | Yes | -- | Log directory for the bot |
| `projectsDir` | `string` | Yes | -- | Claude projects directory for the bot |
| `workspacePath` | `string` | Yes | -- | Absolute path to the workspace directory |
| `port` | `number` | Yes | -- | Allocated port number |
| `token` | `string` | Yes | -- | Auth token for the bot |
| `name` | `string` | Yes | -- | Bot name |
| `mechaDir` | `string` | Yes | -- | Path to `~/.mecha` data directory |
| `auth` | `string \| null` | No | `undefined` | Auth profile name, `null` to opt out of credentials, or `undefined` for implicit resolution |
| `userEnv` | `Record<string, string>` | No | `{}` | User-supplied environment variables (reserved keys are filtered out) |
| `meterOff` | `boolean` | No | `false` | When `true`, skip meter proxy integration entirely |

**Reserved environment variable keys** (filtered from `userEnv`):

All `MECHA_*` internal keys, `HOME`, `TMPDIR`, `PATH`, `BASH_ENV`, `ENV`, `NODE_OPTIONS`, `NODE_PATH`, `NODE_DEBUG`, `NODE_EXTRA_CA_CERTS`, `NODE_REDIRECT_WARNINGS`, `NODE_V8_COVERAGE`, `NODE_PROF`, `LD_PRELOAD`, `LD_LIBRARY_PATH`, `DYLD_INSERT_LIBRARIES`, `DYLD_LIBRARY_PATH`, `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_BASE_URL`. Bash function exports (`BASH_FUNC_*%%`) are also blocked.

Returns `Record<string, string>` -- the complete environment for the child process.

Throws:
- `ProcessSpawnError` if no API credentials are available and `auth` is not explicitly `null`
- `MeterProxyRequiredError` if the meter proxy is configured as required but its port is unreachable
- `AuthProfileNotFoundError` (re-thrown) if an explicit `--auth <name>` profile does not exist

## Port Allocation

### `checkPort(port)`

Check if a TCP port is available by attempting a connection to `127.0.0.1`. Returns `true` if the port is free (connection refused), `false` if in use or on timeout.

```ts
import { checkPort } from "@mecha/process";

const isFree = await checkPort(7700);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `port` | `number` | TCP port number to check |

Returns `Promise<boolean>`.

### `claimPort(port)`

Atomically claim a port by binding a temporary TCP server on `127.0.0.1`. This eliminates the TOCTOU race inherent in `checkPort()` -- the OS guarantees that `bind()` is atomic, so concurrent processes cannot claim the same port.

```ts
import { claimPort } from "@mecha/process";

const release = await claimPort(7700);
if (release) {
  // Port 7700 is held exclusively until release() is called
  await release();
}
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `port` | `number` | TCP port number to claim |

Returns `Promise<(() => Promise<void>) | undefined>`. Returns a release function if the port was successfully claimed, or `undefined` if the port is already in use. The release function is idempotent.

### `allocatePort(base?, max?, exclude?)`

Allocate the first available port in a range using atomic bind via `claimPort()`. Scans sequentially from `base` to `max`, skipping ports in the `exclude` set.

```ts
import { allocatePort } from "@mecha/process";

const claim = await allocatePort(); // default range 7700-7799
console.log(`Allocated port: ${claim.port}`);
// Use the port, then release it
await claim.release();
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `base` | `number` | `7700` | Start of port range |
| `max` | `number` | `7799` | End of port range (inclusive) |
| `exclude` | `Set<number>` | `new Set()` | Ports to skip |

Returns `Promise<PortClaim>`. Throws `PortRangeExhaustedError` if no port in the range is available.

### `PortClaim`

A claimed port with a release function to free it.

| Field | Type | Description |
|-------|------|-------------|
| `port` | `number` | The claimed port number |
| `release` | `() => Promise<void>` | Close the temporary server to free the port. Idempotent |

## Health Check

### `waitForHealthy(port, token, timeoutMs?, botName?)`

Poll `GET /healthz` on a bot runtime until it responds with HTTP 200 or the timeout is reached. Uses exponential backoff starting at 100ms, capped at 1000ms per attempt.

```ts
import { waitForHealthy } from "@mecha/process";

await waitForHealthy(7700, "bot-auth-token", 30000, "researcher");
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `port` | `number` | -- | Port the bot runtime is listening on |
| `token` | `string` | -- | Bearer token for the `Authorization` header |
| `timeoutMs` | `number` | `10000` | Maximum time to wait in milliseconds |
| `botName` | `string` | `"unknown"` | Bot name (used in the error message) |

Returns `Promise<void>`. Throws `ProcessHealthTimeoutError` if the timeout elapses without a successful health check.

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

## `waitForPortFree(port, timeoutMs)`

Poll a TCP port until it becomes free (connection refused). Makes an immediate first probe, then retries every 200 ms until the port is free or the timeout elapses.

```ts
import { waitForPortFree } from "@mecha/process";

const freed = await waitForPortFree(7700, 5000);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `port` | `number` | TCP port to monitor |
| `timeoutMs` | `number` | Maximum time to wait in milliseconds |

Returns `Promise<boolean>`. Returns `true` if the port became free, `false` if the timeout elapsed.

## `readLogs(botDir, name, logOpts?)`

Read logs from a bot's `stdout.log` and `stderr.log` files. Supports tailing the last N lines and following for live updates.

```ts
import { readLogs } from "@mecha/process";

// Read last 50 lines
const stream = readLogs("/Users/you/.mecha/bots/researcher", "researcher", { tail: 50 });
stream.on("data", (chunk) => process.stdout.write(chunk));

// Follow mode (like tail -f)
const follow = readLogs("/Users/you/.mecha/bots/researcher", "researcher", { follow: true });
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `botDir` | `string` | Bot root directory (e.g. `~/.mecha/bots/<name>`) |
| `name` | `BotName` | Bot name (used for error messages) |
| `logOpts` | `LogOpts?` | Optional `{ follow?: boolean; tail?: number }` |

Returns `Readable` stream. Throws `BotNotFoundError` if no state file exists in the bot directory.

In follow mode, the stream uses `watchFile` with a 500ms polling interval to detect new log data. The stream cleans up watchers when closed. Follow mode also handles file truncation/rotation by resetting the read offset.

## PTY (Pseudo-Terminal)

### `MechaPty`

Platform-agnostic PTY handle that wraps `node-pty`.

| Method | Signature | Description |
|--------|-----------|-------------|
| `onData` | `(cb: (data: string) => void) => PtyDisposable` | Subscribe to terminal output data |
| `onExit` | `(cb: (e: { exitCode: number; signal?: number }) => void) => PtyDisposable` | Subscribe to process exit |
| `write` | `(data: string) => void` | Write input to the terminal |
| `resize` | `(cols: number, rows: number) => void` | Resize the terminal |
| `kill` | `(signal?: string) => void` | Kill the process |

### `PtySpawnOpts`

Options passed to a PTY spawn function.

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Terminal name (e.g. `"xterm-256color"`) |
| `cols` | `number` | Number of columns |
| `rows` | `number` | Number of rows |
| `cwd` | `string` | Working directory |
| `env` | `Record<string, string>` | Environment variables |

### `PtySpawnFn`

```ts
type PtySpawnFn = (file: string, args: string[], opts: PtySpawnOpts) => MechaPty;
```

Factory signature for spawning a PTY process. Takes the executable path, arguments, and spawn options.

### `PtyDisposable`

Disposable subscription returned by `onData` and `onExit`.

| Method | Signature | Description |
|--------|-----------|-------------|
| `dispose` | `() => void` | Unsubscribe the callback |

### `createNodePtySpawn()`

Create a `PtySpawnFn` backed by the `node-pty` native addon. The addon is loaded lazily via `require()`.

```ts
import { createNodePtySpawn } from "@mecha/process";

const spawn = createNodePtySpawn();
const pty = spawn("claude", ["--resume", sessionId], {
  name: "xterm-256color",
  cols: 120,
  rows: 40,
  cwd: "/path/to/workspace",
  env: process.env as Record<string, string>,
});
```

Returns `PtySpawnFn`. Throws if `node-pty` is not installed (requires a C++ compiler for native addon build).

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
