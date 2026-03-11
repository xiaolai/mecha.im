# V1 Reuse Guide

What to keep from `mecha.im` (v1) and what to drop.

Out of ~27.5K LOC in v1, ~1.5K LOC is directly reusable, ~1K LOC of patterns worth adapting. The rest is replaced by Docker or was over-abstraction.

## Keep: Utilities (copy directly)

### `safeReadJson()` — `core/src/safe-read.ts`

Discriminated union for file reads. No exceptions.

```typescript
type SafeReadResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "missing" | "corrupt" | "unreadable"; detail: string };
```

Handles ENOENT vs corrupt vs I/O error. Validates with Zod if schema provided. Callers decide how to handle — no thrown errors.

### Validation helpers — `core/src/validation.ts`

- Name: `/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/` (1-32 chars)
- Tags: lowercase alphanumeric + hyphens, dedupe, max 20, max 32 chars each
- Port: reject hex (0x), scientific (1e3), enforce decimal integer 1-65535
- Capabilities: whitelist check

All tight, well-tested, reusable as-is.

### Error system — `core/src/errors.ts`

- Base `MechaError` with `code`, `statusCode` (HTTP), `exitCode` (CLI)
- Factory: `defError<A>(name, opts, msgFn)` creates typed error classes
- Messages are user-friendly and actionable

### Atomic file writes — throughout

Pattern used everywhere in v1: write to temp file, rename atomically. Prevents corrupt state on crash. Use this for all state/config writes in v3.

### Bot token generation — `process/src/spawn-pipeline.ts`

```typescript
const token = "mecha_" + randomBytes(24).toString("hex");
```

Simple, predictable prefix for filtering.

## Keep: Schemas (simplify and reuse)

### Bot config schema — `core/src/bot-config.ts`

Zod schema. For v3, strip these fields:
- `sandboxMode`, `permissionMode` (Docker replaces)
- `budgetLimit`, `maxBudgetUsd` (not in v3 scope)
- `agent`, `agents` (not needed)
- `pluginDirs`, `disableSlashCommands` (not needed)

Add for v3:
- `schedule` (cron entries with prompts)
- `webhooks.accept` (event type allowlist)
- `expose` (host port for external access)

### Cross-field validation — `core/src/bot-config-validation.ts`

The errors vs warnings pattern is good. Rules like "systemPrompt XOR appendSystemPrompt" translate directly.

### Schedule schema — `core/src/schedule.ts`

- Interval parsing: `"5m"` → 300000ms
- Bounds: 10s min, 24h max
- Schema: `{ id, trigger: { type, every, intervalMs }, prompt, paused? }`
- Defaults: MAX_RUNS_PER_DAY=50, MAX_CONSECUTIVE_ERRORS=5, RUN_TIMEOUT=10min

For v3: consider adding cron syntax alongside interval syntax (croner supports both).

### Bot state schema — `process/src/state-store.ts`

```typescript
interface BotState {
  name: string;
  state: "running" | "stopped" | "error";
  pid?: number;        // → replace with containerId
  port?: number;       // → Docker-assigned
  workspacePath: string;
  startedAt?: string;
  stoppedAt?: string;
  exitCode?: number;
}
```

Add `containerId`, `imageId`. Drop `pid`, `sandboxPlatform`, `sandboxMode`.

## Keep: Logic (adapt for containers)

### Auth profiles — `core/src/auth-resolve.ts`

Separation of metadata from secrets:
- `auth/profiles.json` — profile name, type, label, tags, expiresAt
- `auth/credentials.json` — actual keys/tokens

Resolution chain:
1. Explicit profile name → lookup
2. No name → use default
3. `$env:api-key` / `$env:oauth` → read from env vars directly

Type-to-envvar mapping: `oauth` → `CLAUDE_CODE_OAUTH_TOKEN`, `api-key` → `ANTHROPIC_API_KEY`.

Profile name validation: lowercase alphanumeric + hyphens, blacklist (`__proto__`, `constructor`).

Token expiration enforcement.

Drop: TOTP. Keep everything else.

### Session manager — `runtime/src/session-manager.ts`

Moves into the container in v3. Key patterns:
- `.meta.json` + `.jsonl` split per session
- Two-pass discovery: metadata files first, then orphaned transcripts
- Synthesize metadata for in-progress sessions missing `.meta.json`
- Session ID validation: `/^[a-zA-Z0-9_-]+$/`
- Resilient transcript parsing (skip malformed lines, continue)
- Sort by `updatedAt` descending
- 100MB transcript size guard

### Scheduler engine — `runtime/src/scheduler.ts`

Moves into the container in v3. Key patterns:
- Chained `setTimeout` (not `setInterval`) — prevents overlapping runs
- Per-schedule state: nextRunAt, lastRunAt, runCount, runsToday, consecutiveErrors
- Run history tracking with outcome (success/error/skipped)
- Pause/resume per schedule
- Manual trigger (`triggerNow`)
- Race guards between arm and fire

### Per-bot mutex — `process/src/process-manager.ts`

Still needed in v3. Serializes Docker container operations on the same bot (spawn/stop/restart). Prevents race conditions when CLI commands overlap.

### Workspace path resolution — `cli/src/commands/bot-spawn.ts`

macOS symlink issue: `/tmp` → `/private/tmp`. Use `realpathSync()` before mounting volumes. Without this, session paths inside the container won't match host paths.

### Tool patterns — `mcp-server/src/tools/sessions.ts`

Patterns applicable to `mecha_call`, `mecha_list`, `mecha_new_session` (now registered via Agent SDK's `createSdkMcpServer()` + `tool()` helper, not raw MCP):
- Zod schema for input validation (SDK's `tool()` uses zod natively)
- Tool return format: `{ content: [{ type: "text", text: "..." }] }` (MCP CallToolResult)
- Tool group organization (all mecha tools in one `createSdkMcpServer()` instance)

## Drop

| What | Source | Why |
|------|--------|-----|
| 14-package monorepo | all | One package |
| `service` layer | `packages/service/` | CLI → Docker directly |
| Sandbox profiles | `packages/sandbox/` | Docker replaces sandbox-exec and bwrap |
| PTY process management | `packages/process/` | Docker containers, not child processes |
| Atomic port allocation | `process/src/port.ts` | Docker assigns ports |
| Meter proxy | `packages/meter/` | ~3K LOC, not in v3 scope |
| P2P mesh / connect | `packages/connect/` | Docker network DNS replaces this |
| TOTP / dashboard auth | `core/src/auth-config.ts` | Local tool, single user |
| Discovery index | `process/src/discovery.ts` | `docker ps --filter label=mecha.bot` |
| Forwarding / routing | `core/src/forwarding.ts` | `mecha_call` tool replaces this |
| 100% coverage gate | `vitest.config.ts` | 80% is fine |
| 60 extra CLI commands | `cli/src/commands/` | 9 commands total |
| SPA embedding | `packages/spa/` | Separate dashboard build |
| Website | `packages/website/` | Not part of v3 CLI |
| Hand-rolled P2P mesh | `packages/connect/`, CLI node commands | Tailscale replaces this entirely |
| Audit log | `core/src/audit.ts` | Not in v3 scope |
| ACL system | CLI acl commands | Docker network is the trust boundary |

## Source file reference

| Component | Path |
|-----------|------|
| Safe read | `packages/core/src/safe-read.ts` |
| Validation | `packages/core/src/validation.ts` |
| Errors | `packages/core/src/errors.ts` |
| Bot config schema | `packages/core/src/bot-config.ts` |
| Config validation | `packages/core/src/bot-config-validation.ts` |
| Schedule schema | `packages/core/src/schedule.ts` |
| Scheduler engine | `packages/runtime/src/scheduler.ts` |
| Session manager | `packages/runtime/src/session-manager.ts` |
| Auth resolve | `packages/core/src/auth-resolve.ts` |
| State store | `packages/process/src/state-store.ts` |
| Spawn pipeline | `packages/process/src/spawn-pipeline.ts` |
| Process manager | `packages/process/src/process-manager.ts` |
| MCP tools | `packages/mcp-server/src/tools/sessions.ts` |
| Bot spawn CLI | `packages/cli/src/commands/bot-spawn.ts` |
