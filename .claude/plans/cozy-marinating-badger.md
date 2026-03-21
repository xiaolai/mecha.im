# CLI as Single Source of Truth — Service Layer Extraction

## Context

Business logic is duplicated between CLI commands and dashboard API routes. They drift apart: dashboard has PATCH/configure that CLI lacks; CLI has .env loading and `--with-state` that dashboard lacks. The `VALID_PERMISSION_MODES` constant is defined in 3 places. Port allocation works differently (CLI: explicit, dashboard: auto-assign).

**Goal:** Extract all business logic into a shared service layer in `@mecha/docker`. CLI commands and dashboard routes become thin wrappers. No feature exists only in one interface.

## Architecture

```
@mecha/core    — types, constants, errors (already exists)
@mecha/docker  — low-level Docker ops + NEW service layer (service.ts)
@mecha/cli     — thin wrappers: parse args → call service → format output
@mecha/dashboard — thin wrappers: parse HTTP → call service → format response
```

Dashboard-only concerns stay in dashboard: auth/login, chat proxy, SSE framing, `withCreationLock`, env var sanitization.

## Step 1: Add shared constants and errors to `@mecha/core`

**`packages/core/src/constants.ts`** — Add:
```ts
export const VALID_PERMISSION_MODES = ["default", "plan", "full-auto"] as const;
export type PermissionMode = typeof VALID_PERMISSION_MODES[number];
```

**`packages/core/src/errors.ts`** — Add:
- `InvalidPortError` (code: `INVALID_PORT`)
- `NoAvailablePortError` (code: `NO_AVAILABLE_PORT`)
- `InvalidPermissionModeError` (code: `INVALID_PERMISSION_MODE`)

**`packages/core/src/index.ts`** — Export new items.

## Step 2: Create service layer in `@mecha/docker`

**New file: `packages/docker/src/service.ts`**

Service functions — pure business logic, no formatters, no HTTP, no process.exit:

| Function | Extracted From | Notes |
|----------|---------------|-------|
| `mechaUp(client, opts)` → `MechaUpResult` | CLI `up` + dashboard POST `/api/mechas` | Unifies port handling: `port?: number` — explicit if given, auto-allocate if omitted. `loadDotEnv?: boolean` for CLI mode. |
| `mechaRm(client, id, opts)` | CLI `rm` + dashboard DELETE | `opts: { withState?, force? }` |
| `mechaStart(client, id)` | CLI `start` + dashboard POST `.../start` | |
| `mechaStop(client, id)` | CLI `stop` + dashboard POST `.../stop` | |
| `mechaRestart(client, id)` | CLI `restart` + dashboard POST `.../restart` | Tolerates already-stopped (304) internally |
| `mechaLs(client)` → `MechaLsItem[]` | CLI `ls` + dashboard GET `/api/mechas` | |
| `mechaStatus(client, id)` → `MechaStatusResult` | CLI `status` + dashboard GET `.../[id]` | |
| `mechaLogs(client, id, opts)` → `ReadableStream` | CLI `logs` + dashboard GET `.../logs` | `opts: { follow?, tail?, since? }` |
| `mechaConfigure(client, id, opts)` | Dashboard PATCH `.../[id]` (new to CLI) | Stop → remove → recreate → start with updated env |
| `mechaDoctor(client)` → `DoctorResult` | CLI `doctor` + dashboard GET `/api/doctor` | |
| `mechaInit(client)` | CLI `init` | Ensure network + `~/.mecha` dir |
| `mechaResolveUrl(client, id)` → `string` | CLI `ui` + `mcp` | Inspect → extract host port → build URL |
| `mechaExec(client, id, cmd)` | CLI `exec` | |
| `allocatePort(client, requestedPort?)` → `number` | Both | Helper: validate explicit port or find next free |

**`packages/docker/src/index.ts`** — Add `export * from "./service.js"`

### Key design details

**Port allocation unification:** `allocatePort(client, port?)` — if `port` given, validate 1024-65535 and return it. If omitted, scan existing containers and pick next free from PORT_BASE..PORT_MAX.

**Env building in `mechaUp`:** Generates `MECHA_AUTH_TOKEN`, injects `CLAUDE_CODE_OAUTH_TOKEN` from opts or `process.env`, injects `MECHA_OTP` from opts or `process.env`, injects `MECHA_PERMISSION_MODE` if given.

**`.env` loading:** `loadDotEnvFiles(projectPath)` — reads `.env` from project dir and cwd, sets `process.env` (doesn't override existing). CLI passes `loadDotEnv: true`, dashboard passes `false`.

**`mechaConfigure`:** Reads current container env via inspect, merges updates into env map, recreates container. Same logic as current PATCH handler.

**`mechaRestart`/`mechaConfigure`:** Both absorb the `isConflictError` check (304 = already stopped) internally.

## Step 3: Migrate CLI commands

Each command becomes ~15-25 lines: parse args → call service → format output.

| File | Change |
|------|--------|
| `packages/cli/src/commands/up.ts` | Call `mechaUp()`. Port becomes optional (no default). |
| `packages/cli/src/commands/rm.ts` | Call `mechaRm()` |
| `packages/cli/src/commands/lifecycle.ts` | Call `mechaStart/Stop/Restart()` |
| `packages/cli/src/commands/ls.ts` | Call `mechaLs()` |
| `packages/cli/src/commands/status.ts` | Call `mechaStatus()` (watch loop stays in CLI) |
| `packages/cli/src/commands/logs.ts` | Call `mechaLogs()` (stdout piping stays in CLI) |
| `packages/cli/src/commands/doctor.ts` | Call `mechaDoctor()` |
| `packages/cli/src/commands/init.ts` | Call `mechaInit()` |
| `packages/cli/src/commands/ui.ts` | Call `mechaResolveUrl()` |
| `packages/cli/src/commands/mcp.ts` | Call `mechaResolveUrl()` |
| `packages/cli/src/commands/exec.ts` | Call `mechaExec()` |

**New: `packages/cli/src/commands/configure.ts`** — `mecha configure <id>` with flags:
- `--claude-token <token>`
- `--anthropic-key <key>`
- `--otp <secret>`
- `--permission-mode <mode>`

**`packages/cli/src/program.ts`** — Import and register `registerConfigureCommand`.

## Step 4: Migrate dashboard API routes

Each route becomes a thin HTTP adapter: parse request → call service → map errors to HTTP status codes.

| File | Change |
|------|--------|
| `packages/dashboard/src/app/api/mechas/route.ts` | GET → `mechaLs()`, POST → `mechaUp()` (keeps `withCreationLock` and env validation) |
| `packages/dashboard/src/app/api/mechas/[id]/route.ts` | GET → `mechaStatus()`, PATCH → `mechaConfigure()`, DELETE → `mechaRm()` |
| `packages/dashboard/src/app/api/mechas/[id]/start/route.ts` | Call `mechaStart()` |
| `packages/dashboard/src/app/api/mechas/[id]/stop/route.ts` | Call `mechaStop()` |
| `packages/dashboard/src/app/api/mechas/[id]/restart/route.ts` | Call `mechaRestart()` |
| `packages/dashboard/src/app/api/mechas/[id]/logs/route.ts` | Call `mechaLogs()` (SSE framing stays in route) |
| `packages/dashboard/src/app/api/doctor/route.ts` | Call `mechaDoctor()` |

**Stays dashboard-only** (not service layer):
- Auth routes (`/api/auth/login`, `/api/auth/logout`) — HTTP session management
- Chat proxy (`/api/mechas/[id]/chat`) — proxies to runtime, not a mecha operation
- `withCreationLock` — HTTP concurrency concern
- Env var sanitization (`ALLOWED_ENV_KEY`, `BLOCKED_ENV_KEYS`) — API input validation
- SSE stream framing in logs route — presentation layer

## Step 5: Remove duplicated code

- Delete `VALID_PERMISSION_MODES` from `packages/cli/src/commands/up.ts`, `packages/dashboard/src/app/api/mechas/route.ts`, `packages/dashboard/src/app/api/mechas/[id]/route.ts` — use `@mecha/core` import
- `isConflictError` from `packages/dashboard/src/lib/docker-errors.ts` can be removed (absorbed into `mechaRestart`/`mechaConfigure`). Keep `handleDockerError` if still useful as HTTP error mapper, or inline.

## Migration Order

Execute in this order — each step leaves the system working:

1. Add errors + constants to `@mecha/core` (additive)
2. Create `packages/docker/src/service.ts` + export (additive)
3. Add `mecha configure` CLI command (additive, uses new service)
4. Migrate CLI commands one-by-one (each independent)
5. Migrate dashboard routes one-by-one (each independent)
6. Clean up dead code

## Files to Create/Modify (~25)

| # | File | Action |
|---|------|--------|
| 1 | `packages/core/src/constants.ts` | Add `VALID_PERMISSION_MODES`, `PermissionMode` |
| 2 | `packages/core/src/errors.ts` | Add 3 error classes |
| 3 | `packages/core/src/index.ts` | Export new items |
| 4 | `packages/docker/src/service.ts` | **New** — all service functions |
| 5 | `packages/docker/src/index.ts` | Re-export service |
| 6 | `packages/cli/src/commands/up.ts` | Rewrite → `mechaUp()` |
| 7 | `packages/cli/src/commands/rm.ts` | Rewrite → `mechaRm()` |
| 8 | `packages/cli/src/commands/lifecycle.ts` | Rewrite → `mechaStart/Stop/Restart()` |
| 9 | `packages/cli/src/commands/ls.ts` | Rewrite → `mechaLs()` |
| 10 | `packages/cli/src/commands/status.ts` | Rewrite → `mechaStatus()` |
| 11 | `packages/cli/src/commands/logs.ts` | Rewrite → `mechaLogs()` |
| 12 | `packages/cli/src/commands/doctor.ts` | Rewrite → `mechaDoctor()` |
| 13 | `packages/cli/src/commands/init.ts` | Rewrite → `mechaInit()` |
| 14 | `packages/cli/src/commands/ui.ts` | Rewrite → `mechaResolveUrl()` |
| 15 | `packages/cli/src/commands/mcp.ts` | Rewrite → `mechaResolveUrl()` |
| 16 | `packages/cli/src/commands/exec.ts` | Rewrite → `mechaExec()` |
| 17 | `packages/cli/src/commands/configure.ts` | **New** — `mecha configure` |
| 18 | `packages/cli/src/program.ts` | Register configure command |
| 19 | `packages/dashboard/src/app/api/mechas/route.ts` | Rewrite → `mechaLs()`, `mechaUp()` |
| 20 | `packages/dashboard/src/app/api/mechas/[id]/route.ts` | Rewrite → `mechaStatus()`, `mechaConfigure()`, `mechaRm()` |
| 21 | `packages/dashboard/src/app/api/mechas/[id]/start/route.ts` | Rewrite → `mechaStart()` |
| 22 | `packages/dashboard/src/app/api/mechas/[id]/stop/route.ts` | Rewrite → `mechaStop()` |
| 23 | `packages/dashboard/src/app/api/mechas/[id]/restart/route.ts` | Rewrite → `mechaRestart()` |
| 24 | `packages/dashboard/src/app/api/mechas/[id]/logs/route.ts` | Use `mechaLogs()` for stream acquisition |
| 25 | `packages/dashboard/src/app/api/doctor/route.ts` | Rewrite → `mechaDoctor()` |

## Verification

1. `pnpm -r build` — all packages compile
2. `pnpm test` — all existing tests pass
3. `mecha up /path/to/project` — creates mecha (auto-allocates port if no `-p`)
4. `mecha configure <id> --permission-mode plan` — reconfigures and recreates container
5. Dashboard: create mecha via UI → calls same `mechaUp()` function
6. Dashboard: update settings → calls same `mechaConfigure()` function
7. `docker inspect` to verify both paths produce identical container configurations
