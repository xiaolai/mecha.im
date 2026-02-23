# Mecha.im M1 Implementation Plan

## Context

mecha.im is a local-first multi-agent runtime where each Mecha is a containerized CASA (Claude Agent SDK App) instance. The product spec and CLI spec are decision-locked. The project currently has only configuration files (package.json, tsconfig.json, TDD Guardian) with no source code. This plan covers the full M1 milestone: "Single Mecha Local" — `mecha up` from project path with persistent workspace, SQLite state, per-Mecha UI, and MCP endpoint.

## Monorepo Package Layout

```
mecha.im/
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── vitest.workspace.ts
├── Dockerfile.mecha-runtime
├── packages/
│   ├── core/           # @mecha/core — types, ID generation, constants, errors
│   ├── docker/         # @mecha/docker — dockerode abstraction layer
│   ├── cli/            # @mecha/cli — the `mecha` binary (commander)
│   ├── runtime/        # @mecha/runtime — CASA container entrypoint (Fastify)
│   ├── ui/             # @mecha/ui — Next.js + assistant-ui (M1 late)
│   └── hub/            # @mecha/hub — NATS + chat gateway (M3, placeholder only)
```

**Dependency graph:** `core` ← `docker` ← `cli` | `core` ← `runtime` | `core` ← `ui` | `core` ← `hub`

**Key library choices:** commander (CLI), dockerode (Docker), Fastify (runtime HTTP), better-sqlite3 (persistence), @anthropic-ai/claude-agent-sdk (CASA)

---

## Work Items

### Phase 0: Monorepo Scaffolding

| WI | Description | Files |
|---|---|---|
| 0.1 | pnpm workspace + Turborepo setup | `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `vitest.workspace.ts`, root `package.json` |
| 0.2 | `@mecha/core` package skeleton | `packages/core/{package.json,tsconfig.json,src/index.ts}` |
| 0.3 | `@mecha/docker` package skeleton | `packages/docker/{package.json,tsconfig.json,src/index.ts}` |
| 0.4 | `@mecha/cli` package skeleton with `bin` field | `packages/cli/{package.json,tsconfig.json,src/bin.ts}` |
| 0.5 | `@mecha/runtime` package skeleton | `packages/runtime/{package.json,tsconfig.json,src/index.ts}` |

**Accept:** `pnpm install` succeeds, `pnpm -r build` compiles all packages, `pnpm test` runs.

### Phase 1: Core Library (`@mecha/core`)

| WI | Description | Files |
|---|---|---|
| 1.1 | Mecha ID generation — `computeMechaId(path) → mx-<slug>-<pathhash>` | `packages/core/src/id.ts`, `packages/core/__tests__/id.test.ts` |
| 1.2 | Resource naming — `containerName()`, `volumeName()`, `networkName()` | `packages/core/src/id.ts`, tests |
| 1.3 | Core types — `MechaId`, `MechaConfig`, `MechaState`, `MechaInfo`, `MechaHeartbeat`, `GlobalOptions` | `packages/core/src/types.ts` |
| 1.4 | Error hierarchy — `MechaError`, `DockerNotAvailableError`, `ContainerNotFoundError`, etc. | `packages/core/src/errors.ts`, tests |
| 1.5 | Constants — default ports, mount paths, network/image names | `packages/core/src/constants.ts`, tests |

**ID algorithm:**
1. Canonicalize path (resolve to absolute)
2. Slug = final directory name, kebab-case, sanitized
3. Pathhash = first 6 chars of base36-encoded SHA-256 of canonical path
4. ID = `mx-<slug>-<pathhash>`

### Phase 2: Docker Abstraction (`@mecha/docker`)

| WI | Description | Files |
|---|---|---|
| 2.1 | Docker client factory + `ping()` health check | `packages/docker/src/client.ts`, tests |
| 2.2 | Network ops — `ensureNetwork()`, `removeNetwork()` (idempotent) | `packages/docker/src/network.ts`, tests |
| 2.3 | Volume ops — `ensureVolume()`, `removeVolume()` (idempotent) | `packages/docker/src/volume.ts`, tests |
| 2.4 | Container ops — create/start/stop/rm/inspect/list/logs/exec with security defaults baked in | `packages/docker/src/container.ts`, tests |
| 2.5 | Image ops — `pullImage()`, `imageExists()` | `packages/docker/src/image.ts`, tests |

**Security defaults enforced in container create (hard requirements):**
- `--read-only`, `--cap-drop=ALL`, `--security-opt=no-new-privileges`
- `--user 1000:1000`, no `sudo`
- Labels: `mecha=true`, `mecha.id=<id>`, `mecha.path=<path>`

### Phase 3: CLI Commands (`@mecha/cli`)

| WI | Description | Files |
|---|---|---|
| 3.1 | CLI entry point + global flags (`--json`, `--quiet`, `--verbose`, `--no-color`) + output formatter | `packages/cli/src/bin.ts`, `packages/cli/src/output/formatter.ts`, tests |
| 3.2 | `mecha doctor` — check Docker, network, hub status | `packages/cli/src/commands/doctor.ts`, tests |
| 3.3 | `mecha init` — ensure `mecha-net`, create `~/.mecha/` | `packages/cli/src/commands/init.ts`, tests |
| 3.4 | `mecha up <path>` — compute ID, create volume, create+start container, print status | `packages/cli/src/commands/up.ts`, tests |
| 3.5 | `mecha ls [--json]` — list all mecha containers | `packages/cli/src/commands/ls.ts`, tests |
| 3.6 | `mecha stop/start/restart <id>` | `packages/cli/src/commands/{stop,start,restart}.ts`, tests |
| 3.7 | `mecha rm <id> [--with-state] [--force]` | `packages/cli/src/commands/rm.ts`, tests |
| 3.8 | `mecha status <id> [--json] [--watch]` | `packages/cli/src/commands/status.ts`, tests |
| 3.9 | `mecha logs <id> [--follow] [--tail] [--since] [--component]` | `packages/cli/src/commands/logs.ts`, tests |
| 3.10 | `mecha exec <id> -- <command...>` | `packages/cli/src/commands/exec.ts`, tests |
| 3.11 | `mecha ui <id>` and `mecha mcp <id>` — print URLs/tokens/config | `packages/cli/src/commands/{ui,mcp}.ts`, tests |

### Phase 4: Runtime (`@mecha/runtime`) — runs inside container

| WI | Description | Files |
|---|---|---|
| 4.1 | Fastify server bootstrap + `/healthz` + `/info` + graceful shutdown | `packages/runtime/src/server.ts`, tests |
| 4.2 | SQLite setup + migration runner + initial schema | `packages/runtime/src/db/sqlite.ts`, `packages/runtime/src/db/migrations/`, tests |
| 4.3 | Auth token generation + Bearer middleware | `packages/runtime/src/auth/token.ts`, tests |
| 4.4 | MCP server — streamable HTTP transport on Fastify + tool registration | `packages/runtime/src/mcp/{server,transport}.ts`, tests |
| 4.5 | Claude Agent SDK integration — `POST /api/chat` | `packages/runtime/src/agent/casa.ts`, tests |
| 4.6 | Supervisor heartbeat — periodic status to local SQLite | `packages/runtime/src/supervisor/heartbeat.ts`, tests |

### Phase 5: Container Image

| WI | Description | Files |
|---|---|---|
| 5.1 | Multi-stage Dockerfile — build TS, production node:20-slim, non-root user | `Dockerfile.mecha-runtime` |
| 5.2 | Integration test — build image, start container, verify `/healthz` | integration tests |

### Phase 6: Per-Mecha UI (Minimal)

| WI | Description | Files |
|---|---|---|
| 6.1 | Next.js + assistant-ui scaffold — basic chat UI connecting to runtime `/api/chat` | `packages/ui/` |

---

## Build Order (respects dependency graph)

```
Phase 0 (scaffolding) → Phase 1 (core) → Phase 2 (docker)
                                        ↗ Phase 3 (cli)      → Phase 5 (dockerfile)
                         Phase 1 (core) → Phase 4 (runtime)  ↗
                                                              → Phase 6 (ui)
```

Phases 3 and 4 can proceed in parallel since CLI and runtime are independent packages.

## Testing Strategy

- **100% coverage** enforced by TDD Guardian on lines/functions/branches/statements
- **`@mecha/core`**: pure unit tests, no mocks needed. Property-based tests (fast-check) for ID generation.
- **`@mecha/docker`**: unit tests with mocked `dockerode`. Verify security flags in create options.
- **`@mecha/cli`**: mock Docker layer injected into command handlers. Test commander parsing.
- **`@mecha/runtime`**: `app.inject()` for HTTP, `:memory:` SQLite, mocked Agent SDK, vitest fake timers for heartbeat.
- **Dependency injection** throughout — every I/O module accepts dependencies via constructor/factory for testability.

## Verification

1. `pnpm -r build` — all packages compile
2. `pnpm test` — all tests pass
3. `pnpm test -- --coverage` — 100% coverage
4. `pnpm exec tsc --noEmit` — type check passes
5. `docker build -f Dockerfile.mecha-runtime .` — image builds
6. Manual: `mecha init && mecha up /tmp/test-project && mecha status <id> && mecha rm <id>`
