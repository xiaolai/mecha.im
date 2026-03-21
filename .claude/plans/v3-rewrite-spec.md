# mecha.im v3 — Implementation Spec

> Date: 2026-02-21
> Status: Final Draft
> Previous: `v2-rewrite-spec.md` (superseded), `rewrite-review.md` (audit trail)

---

## 1. Target Architecture

### 1.1 Package Structure

```
@mecha/core       — types, constants, errors, ID generation, TOTP (zero runtime deps)
@mecha/contracts  — NEW: Zod schemas for all service operations (deps: zod)
@mecha/docker     — thin Docker client wrapper (deps: dockerode, @mecha/core)
@mecha/service    — NEW: business logic layer (deps: @mecha/contracts, @mecha/docker, @mecha/core)
@mecha/runtime    — container-side Fastify server (deps: @mecha/core, agent-sdk, mcp-sdk, fastify, zod)
@mecha/cli        — thin CLI wrapper (deps: @mecha/service, @mecha/core, commander)
@mecha/dashboard  — thin HTTP wrapper (deps: @mecha/service, @mecha/core, next)
```

**Deleted**: `packages/ui/` (superseded by dashboard), `packages/hub/` (empty stub)

**Why `@mecha/contracts` instead of Zod in core**: `@mecha/core` is currently zero-dependency (pure Node stdlib). Adding Zod would force a runtime dependency on every consumer including `@mecha/runtime` inside the container. A separate `@mecha/contracts` package keeps core pure and lets consumers opt in.

### 1.2 Dependency DAG

```
                       ┌─── @mecha/cli
core ──┬── docker ─── service ─┤
       │                       └─── @mecha/dashboard
       └── contracts ──┘

core ── runtime  (independent, runs inside container — never imports docker/service/cli/dashboard)
```

**Exception**: `@mecha/cli` depends on `@mecha/dashboard` via the `mecha dashboard` command (process spawning, not code import). This is an orchestration dependency, not a code dependency. The `dashboard.ts` command file spawns `next start` as a child process and does not import any dashboard module. This is acceptable and unchanged.

### 1.3 Resolved Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| TOTP location | Stays in `@mecha/core` | Dashboard login + runtime auth both use it |
| Zod schemas | New `@mecha/contracts` package | Keeps core zero-dependency |
| Port allocation | Docker-native (`HostPort: ""`) + post-start inspect; `--port` for explicit override | Eliminates race, no custom allocator. Use `""` not `"0"` (Dockerode convention) |
| Event bus | Deferred; poll via Docker API | In-memory emitter can't cross processes |
| .env loading | Pure function in `@mecha/service`, returns `Record<string, string>` | No process.env mutation |
| Config precedence | Callers (CLI/dashboard) resolve precedence; service receives final values. `loadDotEnv` removed from service API | Single owner for config resolution |
| Migration strategy | Phase-by-phase branch merges, green gates after each phase | No feature flags needed at ~3.5K LOC |
| Thin wrapper constraint | No Docker business logic in CLI/dashboard (behavior-based, not LOC-based) | Streaming/process commands may be longer |
| `resolveHostPort` | Split into two service functions: `resolveUiUrl(id)` and `resolveMcpEndpoint(id)` | Different output shapes |
| Breaking changes | Phase 1-3 are non-breaking (additive). Phase 4 changes port behavior (documented below) | Explicit marking |

---

## 2. Phase 1: Contracts + Quick Fixes (Non-Breaking, Additive)

**Goal**: Shared schemas, error types, security fix. Zero behavior changes.

**Merge checkpoint**: All gates green after this phase before starting Phase 2.

### 2.1 New Package: `@mecha/contracts`

**Files to create**:

```
packages/contracts/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    index.ts
    schemas.ts
    errors.ts
  __tests__/
    schemas.test.ts
    errors.test.ts
```

**`packages/contracts/package.json`**:
```json
{
  "name": "@mecha/contracts",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" } },
  "scripts": { "build": "tsc", "typecheck": "tsc --noEmit", "test": "vitest run", "test:coverage": "vitest run --coverage" },
  "dependencies": { "@mecha/core": "workspace:*", "zod": "^4.3.6" },
  "devDependencies": { "@types/node": "^25.3.0", "@vitest/coverage-v8": "^4.0.18", "typescript": "^5.9.3", "vitest": "^4.0.18" }
}
```

### 2.2 Schemas (`packages/contracts/src/schemas.ts`)

```typescript
import { z } from "zod";

// --- Shared constants (single source of truth) ---

export const PERMISSION_MODES = ["default", "plan", "full-auto"] as const;
export const PermissionMode = z.enum(PERMISSION_MODES);
export type PermissionMode = z.infer<typeof PermissionMode>;

/** Env var keys that must not be set by users (managed internally) */
export const BLOCKED_ENV_KEYS = new Set([
  "PATH", "HOME", "USER", "SHELL", "LD_PRELOAD", "LD_LIBRARY_PATH",
  "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "MECHA_OTP",
  "MECHA_PERMISSION_MODE", "MECHA_AUTH_TOKEN", "MECHA_ID",
]);

/** Pattern for allowed env var keys */
const ALLOWED_ENV_KEY = /^[A-Z][A-Z0-9_]*$/;

/** Validates a single env entry "KEY=VALUE" */
const EnvEntry = z.string().refine((entry) => {
  const eqIdx = entry.indexOf("=");
  if (eqIdx <= 0) return false;
  const key = entry.slice(0, eqIdx);
  return ALLOWED_ENV_KEY.test(key) && !BLOCKED_ENV_KEYS.has(key);
}, { message: "Invalid env entry: must be KEY=VALUE with allowed uppercase key" });

// --- Service operation schemas ---

export const MechaUpInput = z.object({
  projectPath:    z.string().min(1),
  port:           z.number().int().min(1024).max(65535).optional(),
  claudeToken:    z.string().optional(),
  anthropicApiKey: z.string().optional(),
  otp:            z.string().optional(),
  permissionMode: PermissionMode.optional(),
  env:            z.array(EnvEntry).optional(),
});
export type MechaUpInput = z.infer<typeof MechaUpInput>;

export const MechaUpResult = z.object({
  id:        z.string(),
  name:      z.string(),
  port:      z.number(),
  authToken: z.string(),
});
export type MechaUpResult = z.infer<typeof MechaUpResult>;

export const MechaRmInput = z.object({
  id:        z.string().min(1),
  withState: z.boolean().default(false),
  force:     z.boolean().default(false),
});
export type MechaRmInput = z.infer<typeof MechaRmInput>;

export const MechaConfigureInput = z.object({
  id:              z.string().min(1),
  claudeToken:     z.string().optional(),
  anthropicApiKey: z.string().optional(),
  otp:             z.string().optional(),
  permissionMode:  PermissionMode.optional(),
});
export type MechaConfigureInput = z.infer<typeof MechaConfigureInput>;

export const MechaLogsInput = z.object({
  id:     z.string().min(1),
  follow: z.boolean().default(false),
  tail:   z.number().int().min(0).default(100),
  since:  z.number().optional(),
});
export type MechaLogsInput = z.infer<typeof MechaLogsInput>;

export const MechaExecInput = z.object({
  id:  z.string().min(1),
  cmd: z.array(z.string()).min(1),
});
export type MechaExecInput = z.infer<typeof MechaExecInput>;

export const MechaLsItem = z.object({
  id:      z.string(),
  name:    z.string(),
  state:   z.string(),
  status:  z.string(),
  path:    z.string(),
  port:    z.number().optional(),
  created: z.number(),
});
export type MechaLsItem = z.infer<typeof MechaLsItem>;

export const MechaStatusResult = z.object({
  id:         z.string(),
  name:       z.string(),
  state:      z.string(),
  running:    z.boolean(),
  port:       z.number().optional(),
  path:       z.string(),
  image:      z.string(),
  startedAt:  z.string().optional(),
  finishedAt: z.string().optional(),
});
export type MechaStatusResult = z.infer<typeof MechaStatusResult>;

export const DoctorResult = z.object({
  dockerAvailable: z.boolean(),
  networkExists:   z.boolean(),
  issues:          z.array(z.string()),
});
export type DoctorResult = z.infer<typeof DoctorResult>;

export const UiUrlResult = z.object({
  url: z.string(),
});
export type UiUrlResult = z.infer<typeof UiUrlResult>;

export const McpEndpointResult = z.object({
  endpoint: z.string(),
  note:     z.string(),
});
export type McpEndpointResult = z.infer<typeof McpEndpointResult>;
```

### 2.3 Error Types (`packages/contracts/src/errors.ts`)

```typescript
import { MechaError } from "@mecha/core";
import { ZodError } from "zod";

// --- New error classes ---

export class InvalidPortError extends MechaError {
  constructor(port: number) { super(`Invalid port: ${port} (must be 1024-65535)`, "INVALID_PORT"); }
}

export class InvalidPermissionModeError extends MechaError {
  constructor(mode: string) { super(`Invalid permission mode: ${mode} (must be one of: default, plan, full-auto)`, "INVALID_PERMISSION_MODE"); }
}

export class ContainerStartError extends MechaError {
  constructor(name: string, cause?: Error) {
    super(`Failed to start container ${name}: ${cause?.message ?? "unknown"}`, "CONTAINER_START_FAILED");
    if (cause) this.cause = cause;
  }
}

export class PathNotFoundError extends MechaError {
  constructor(path: string) { super(`Path does not exist: ${path}`, "PATH_NOT_FOUND"); }
}

export class PathNotDirectoryError extends MechaError {
  constructor(path: string) { super(`Path is not a directory: ${path}`, "PATH_NOT_DIRECTORY"); }
}

export class NoPortBindingError extends MechaError {
  constructor(id: string) { super(`No port binding found for mecha: ${id}`, "NO_PORT_BINDING"); }
}

export class ConfigureNoFieldsError extends MechaError {
  constructor() { super("At least one field required: claudeToken, anthropicApiKey, otp, permissionMode", "CONFIGURE_NO_FIELDS"); }
}

// --- Error mapping helpers ---

const HTTP_STATUS_MAP: Record<string, number> = {
  INVALID_PORT: 400,
  INVALID_PERMISSION_MODE: 400,
  PATH_NOT_FOUND: 400,
  PATH_NOT_DIRECTORY: 400,
  CONFIGURE_NO_FIELDS: 400,
  CONTAINER_NOT_FOUND: 404,
  CONTAINER_ALREADY_EXISTS: 409,
  CONTAINER_START_FAILED: 500,
  DOCKER_NOT_AVAILABLE: 503,
  NO_PORT_BINDING: 500,
  INVALID_PATH: 400,
  IMAGE_NOT_FOUND: 500,
};

export function toHttpStatus(err: unknown): number {
  if (err instanceof MechaError) return HTTP_STATUS_MAP[err.code] ?? 500;
  if (err instanceof ZodError) return 400;
  return 500;
}

export function toExitCode(_err: unknown): number {
  return 1; // All errors are exit code 1 for CLI
}

export function toUserMessage(err: unknown): string {
  if (err instanceof ZodError) return `Validation error: ${err.issues.map(i => i.message).join("; ")}`;
  if (err instanceof Error) return err.message;
  return "Unknown error";
}
```

### 2.4 Security Fix: Token Logging

**File**: `packages/runtime/src/server.ts` line 34

**Before**:
```typescript
if (!opts.authToken) app.addHook("onReady", () => app.log.info(`Auth token: ${token}`));
```

**After**:
```typescript
if (!opts.authToken) app.addHook("onReady", () => app.log.info(`Auth token: ${token.slice(0, 8)}... (use 'docker exec <container> printenv MECHA_AUTH_TOKEN' to reveal)`));
```

### 2.5 Config Files to Create/Modify

| File | Action | Change |
|------|--------|--------|
| `packages/contracts/package.json` | Create | As shown above |
| `packages/contracts/tsconfig.json` | Create | Extends `../../tsconfig.base.json`, references `../core` |
| `packages/contracts/vitest.config.ts` | Create | 100% coverage gates |
| `packages/contracts/src/schemas.ts` | Create | All schemas |
| `packages/contracts/src/errors.ts` | Create | Error classes + mapping |
| `packages/contracts/src/index.ts` | Create | Re-export schemas + errors |
| `packages/contracts/__tests__/schemas.test.ts` | Create | Schema parse/reject tests |
| `packages/contracts/__tests__/errors.test.ts` | Create | Mapping tests |
| `pnpm-workspace.yaml` | No change | Already uses `packages/*` glob |
| `turbo.json` | No change | Generic `build` task covers new package |
| `vitest.workspace.ts` | Modify | Add `contracts` project |
| `tsconfig.json` | Modify | Add `contracts` reference |
| `packages/runtime/src/server.ts` | Modify | Token logging fix |

### 2.6 Acceptance Criteria

- [ ] `packages/contracts/` exists with schemas, errors, mapping helpers
- [ ] `VALID_PERMISSION_MODES` constant only exists in `@mecha/contracts` — not removed from other files yet (additive, Phase 4 removes)
- [ ] `BLOCKED_ENV_KEYS` and `EnvEntry` validator match current dashboard logic
- [ ] `anthropicApiKey` field present in `MechaUpInput` and `MechaConfigureInput`
- [ ] Error mapping: `toHttpStatus`, `toExitCode`, `toUserMessage` have full test coverage
- [ ] Auth token no longer fully logged in runtime
- [ ] Existing behavior in all other packages unchanged
- [ ] `pnpm test && pnpm test:coverage && pnpm typecheck` pass

---

## 3. Phase 2: Transactional Safety + Port Migration (Non-Breaking)

**Goal**: Fix multi-step rollback bugs. Switch port allocation to Docker-native. Both are independent of service extraction.

**Merge checkpoint**: Green gates after this phase.

### 3.1 Docker Port Change

**File**: `packages/docker/src/container.ts`

**Change `CreateContainerOptions`**:
```typescript
export interface CreateContainerOptions {
  containerName: string;
  image: string;
  mechaId: MechaId;
  projectPath: string;
  volumeName: string;
  hostPort?: number;  // was: hostPort: number (required)
  env?: string[];
}
```

**Change `createContainer`**:
```typescript
PortBindings: {
  [`${DEFAULTS.CONTAINER_PORT}/tcp`]: [
    { HostIp: "127.0.0.1", HostPort: opts.hostPort ? String(opts.hostPort) : "" },
  ],
},
```

**Add `getContainerPort`**:
```typescript
export async function getContainerPort(client: DockerClient, name: string): Promise<number | undefined> {
  const info = await inspectContainer(client, name);
  const bindings = info.NetworkSettings?.Ports?.[`${DEFAULTS.CONTAINER_PORT}/tcp`];
  const portStr = bindings?.[0]?.HostPort;
  return portStr ? parseInt(portStr, 10) : undefined;
}
```

**Export from `packages/docker/src/index.ts`**: Add `getContainerPort`.

**Compatibility note**: Making `hostPort` optional is backward-compatible. All existing callers pass a number, which still works. The `""` empty-string path is new.

### 3.2 Container Create+Start Rollback

Apply to **both** `packages/cli/src/commands/up.ts` and `packages/dashboard/src/app/api/mechas/route.ts`:

```typescript
// After createContainer succeeds:
try {
  await startContainer(client, containerName);
} catch (startErr) {
  try { await removeContainer(client, containerName, true); } catch { /* best effort */ }
  throw startErr; // or throw new ContainerStartError(containerName, startErr)
}
```

### 3.3 Dashboard Reconfigure Rollback

**File**: `packages/dashboard/src/app/api/mechas/[id]/route.ts` PATCH handler

**Transactional state table**:

| Step | Failure at this step | Resulting state | Recovery action |
|------|---------------------|-----------------|-----------------|
| 1. Inspect current | Fails | Unchanged | Return error |
| 2. Stop container | Fails (not already stopped) | Unchanged | Return error |
| 3. Remove container | Fails | Stopped | Try restart original |
| 4. Create new container | Fails | Removed | Recreate with original config |
| 5. Start new container | Fails | Created (not started) | Remove new, recreate + start original |

**Implementation**:
```typescript
// 1. Save current state for rollback
const originalInfo = await inspectContainer(client, name);
const originalEnv = originalInfo.Config?.Env ?? [];
const originalImage = originalInfo.Config?.Image ?? DEFAULTS.IMAGE;
// ... extract projectPath, volumeName, hostPort from originalInfo ...

// 2. Stop (tolerate already-stopped)
try { await stopContainer(client, name); } catch (e) { if (!isConflictError(e)) throw e; }

// 3-5. Remove → Create → Start with rollback
try {
  await removeContainer(client, name, true);
  await createContainer(client, newOpts);
  try {
    await startContainer(client, name);
  } catch (startErr) {
    // Start failed: remove new container, restore original
    try { await removeContainer(client, name, true); } catch { /* best effort */ }
    await createContainer(client, originalOpts);
    await startContainer(client, name);
    throw startErr;
  }
} catch (err) {
  // If remove succeeded but create failed: recreate original
  // Outer handler catches and responds with 500
  // Rollback attempt: recreate + start original config
  try {
    await createContainer(client, originalOpts);
    await startContainer(client, name);
  } catch { /* rollback also failed — log and surface original error */ }
  throw err;
}
```

**Where `originalOpts`** is reconstructed from inspect data:
```typescript
const originalOpts = {
  containerName: name,
  image: originalImage,
  mechaId,
  projectPath: originalInfo.Config?.Labels?.[LABELS.MECHA_PATH] ?? "",
  volumeName: originalInfo.Mounts?.find(m => m.Destination === MOUNT_PATHS.STATE)?.Name ?? "",
  hostPort: Number(originalInfo.NetworkSettings?.Ports?.[`${DEFAULTS.CONTAINER_PORT}/tcp`]?.[0]?.HostPort),
  env: originalEnv.filter(e => !e.startsWith("MECHA_ID=")),
};
```

### 3.4 Files Modified

| File | Change |
|------|--------|
| `packages/docker/src/container.ts` | `hostPort` optional, add `getContainerPort()` |
| `packages/docker/src/index.ts` | Export `getContainerPort` |
| `packages/docker/__tests__/container.test.ts` | Tests for optional port, `getContainerPort` |
| `packages/cli/src/commands/up.ts` | Add rollback on start failure |
| `packages/cli/__tests__/commands/up.test.ts` | Test rollback path |
| `packages/dashboard/src/app/api/mechas/route.ts` | Add rollback on start failure |
| `packages/dashboard/src/app/api/mechas/[id]/route.ts` | Full PATCH rollback |

### 3.5 Acceptance Criteria

- [ ] `CreateContainerOptions.hostPort` is optional
- [ ] `getContainerPort()` returns port from inspect data
- [ ] CLI `up`: if start fails, container is removed (test: mock startContainer to throw)
- [ ] Dashboard POST: if start fails, container is removed
- [ ] Dashboard PATCH: if recreate/start fails, original config is restored (test all 3 failure points)
- [ ] Docker `HostPort: ""` tested with integration test (Docker picks a free port)
- [ ] `pnpm test && pnpm test:coverage && pnpm typecheck` pass

---

## 4. Phase 3: Integration Tests (Non-Breaking)

**Goal**: Lock current behavior against real Docker before the big refactor.

**Merge checkpoint**: Green gates. Integration tests gated behind `INTEGRATION=true`.

### 4.1 Test Location

Integration tests go in `packages/docker/__tests__/integration/` (not `packages/service/` which doesn't exist yet).

### 4.2 Setup

**File**: `packages/docker/__tests__/integration/lifecycle.test.ts`

```typescript
import { describe, it, beforeAll, afterAll, expect } from "vitest";

const SKIP = !process.env.INTEGRATION;

describe.skipIf(SKIP)("Docker integration", () => {
  let client: DockerClient;
  const TEST_LABEL = "mecha-test";

  beforeAll(async () => {
    client = createDockerClient();
    // Pull test image if needed
    // Create test network
  });

  afterAll(async () => {
    // Remove all containers with TEST_LABEL
    // Remove test network
  });

  // ... test cases ...
});
```

### 4.3 Test Cases

| # | Test | Verifies |
|---|------|----------|
| 1 | Create + start + inspect + stop + remove | Full lifecycle round-trip |
| 2 | Create with explicit `hostPort: 7788` → inspect returns 7788 | Explicit port binding |
| 3 | Create with `hostPort` omitted → inspect returns Docker-assigned port > 0 | Dynamic port allocation |
| 4 | Create succeeds, mock-inject start failure → container is cleaned up | Rollback (unit-level, mocked) |
| 5 | Two containers → `listMechaContainers` returns both | Listing |
| 6 | `execInContainer` with `["echo", "hello"]` → output contains "hello" | Exec |
| 7 | `getContainerLogs` with `follow: false` → returns log content | Log retrieval |
| 8 | `getContainerPort` on running container → returns bound port | Port resolution |

### 4.4 Config Changes

**`vitest.workspace.ts`** — add integration project:
```typescript
{
  test: {
    name: "integration",
    include: ["packages/docker/__tests__/integration/**/*.test.ts"],
  },
},
```

**Root `package.json`** — add script:
```json
"test:integration": "INTEGRATION=true vitest run --project integration"
```

### 4.5 Acceptance Criteria

- [ ] Integration test file exists at `packages/docker/__tests__/integration/lifecycle.test.ts`
- [ ] `pnpm test` skips integration tests (no `INTEGRATION` env)
- [ ] `INTEGRATION=true pnpm test:integration` runs and passes locally
- [ ] All 8 test cases implemented
- [ ] Cleanup: test containers removed in afterAll
- [ ] `pnpm test && pnpm test:coverage && pnpm typecheck` pass (unit tests unaffected)

---

## 5. Phase 4: Extract `@mecha/service` (Breaking: Port Default Change)

**Goal**: Single service layer. CLI and dashboard become thin wrappers with no Docker business logic.

**Merge checkpoint**: Green gates + integration tests pass with new code paths.

**Breaking change**: `mecha up` without `--port` now gets a Docker-assigned port instead of defaulting to 7700. Document in changelog.

### 5.1 Package Setup

```
packages/service/
  package.json          # deps: @mecha/contracts, @mecha/docker, @mecha/core
  tsconfig.json         # references: core, contracts, docker
  vitest.config.ts      # 100% coverage gates
  src/
    index.ts
    service.ts          # all service functions
    env.ts              # pure .env loading
  __tests__/
    service.test.ts
    env.test.ts
```

### 5.2 Service Function Contracts (15 functions)

Every function receives **typed input** (not `raw: unknown`). CLI and dashboard parse/validate before calling. Service functions may throw typed errors from `@mecha/contracts`.

| # | Function | Input | Output | Throws | Side Effects |
|---|----------|-------|--------|--------|--------------|
| 1 | `mechaUp(client, input: MechaUpInput)` | `MechaUpInput` | `MechaUpResult` | `PathNotFoundError`, `PathNotDirectoryError`, `InvalidPortError`, `ContainerStartError` | Creates network, volume, container; starts container |
| 2 | `mechaRm(client, input: MechaRmInput)` | `MechaRmInput` | `void` | `ContainerNotFoundError` | Removes container, optionally volume |
| 3 | `mechaStart(client, id: string)` | `string` | `void` | `ContainerNotFoundError` | Starts container |
| 4 | `mechaStop(client, id: string)` | `string` | `void` | `ContainerNotFoundError` | Stops container |
| 5 | `mechaRestart(client, id: string)` | `string` | `void` | `ContainerNotFoundError` | Stops then starts container |
| 6 | `mechaLs(client)` | none | `MechaLsItem[]` | `DockerNotAvailableError` | Read-only |
| 7 | `mechaStatus(client, id: string)` | `string` | `MechaStatusResult` | `ContainerNotFoundError` | Read-only |
| 8 | `mechaLogs(client, input: MechaLogsInput)` | `MechaLogsInput` | `NodeJS.ReadableStream` | `ContainerNotFoundError` | Returns raw Docker log stream |
| 9 | `mechaExec(client, input: MechaExecInput)` | `MechaExecInput` | `{ exitCode: number; output: string }` | `ContainerNotFoundError` | Executes command in container |
| 10 | `mechaConfigure(client, input: MechaConfigureInput)` | `MechaConfigureInput` | `void` | `ContainerNotFoundError`, `ConfigureNoFieldsError`, `ContainerStartError` | Stop → remove → recreate → start (with rollback) |
| 11 | `mechaDoctor(client)` | none | `DoctorResult` | none (returns issues in result) | Read-only |
| 12 | `mechaInit(client)` | none | `void` | `DockerNotAvailableError` | Creates network, config dir |
| 13 | `resolveUiUrl(client, id: string)` | `string` | `UiUrlResult` | `ContainerNotFoundError`, `NoPortBindingError` | Read-only |
| 14 | `resolveMcpEndpoint(client, id: string)` | `string` | `McpEndpointResult` | `ContainerNotFoundError`, `NoPortBindingError` | Read-only |
| 15 | `loadDotEnvFiles(projectPath: string, cwd: string)` | `string, string` | `Record<string, string>` | none | Reads filesystem, never mutates process.env |

**Note on `mechaLogs`**: Returns the raw Docker log stream. Stream demuxing and SSE framing remain in the consumer layer (dashboard logs route). This is a justified non-thin exception — the dashboard logs route handles Docker multiplexed frame parsing (~40 lines of binary protocol) which is transport-specific, not business logic. The service layer should not own SSE formatting.

**Note on `mechaStatus`**: The current CLI `status` command and dashboard GET `[id]` return different shapes. The service function returns a unified `MechaStatusResult`. CLI formats it as text/json. Dashboard may return additional fields by augmenting the response (non-breaking).

### 5.3 Config Precedence (Resolved)

Service receives **final resolved values**. Config resolution is the caller's responsibility:

**CLI** (`up` command):
```
1. --port flag                        (highest)
2. MECHA_PORT env var (future)
3. .env file from project dir
4. .env file from cwd
5. undefined → Docker assigns          (lowest)
```

**Dashboard** (`POST /api/mechas`):
```
1. Request body field                  (highest)
2. Server env var (process.env)
3. undefined → Docker assigns          (lowest)
```

Dashboard **never** loads `.env` files. CLI calls `loadDotEnvFiles()` and merges results before calling service.

### 5.4 Pure .env Loading (`packages/service/src/env.ts`)

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Load .env files from specified directories.
 * Returns a merged record where earlier directories take priority.
 * Never mutates process.env.
 */
export function loadDotEnvFiles(projectPath: string, cwd: string): Record<string, string> {
  const result: Record<string, string> = {};
  const dirs = [...new Set([projectPath, cwd])];
  for (const dir of dirs) {
    try {
      const content = readFileSync(join(dir, ".env"), "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx);
          if (!(key in result)) result[key] = trimmed.slice(eqIdx + 1);
        }
      }
    } catch { /* no .env file, fine */ }
  }
  return result;
}
```

### 5.5 CLI Migration Example: `up.ts`

**Before** (120 lines, business logic inline):
```typescript
// Current: validates path, loads .env, ensures network/volume, builds env array,
// creates container, starts container, formats output — all inline
```

**After** (~30 lines, thin wrapper):
```typescript
import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { resolve } from "node:path";
import { mechaUp, loadDotEnvFiles } from "@mecha/service";
import { toUserMessage, toExitCode } from "@mecha/contracts";

export function registerUpCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("up <path>")
    .description("Create and start a Mecha from a project path")
    .option("-p, --port <port>", "Host port to bind")
    .option("--claude-token <token>", "Claude OAuth token")
    .option("--anthropic-key <key>", "Anthropic API key")
    .option("--otp <secret>", "TOTP secret")
    .option("--permission-mode <mode>", "Permission mode: default, plan, full-auto")
    .option("--show-token", "Print the full auth token to stdout")
    .action(async (pathArg: string, cmdOpts) => {
      const { dockerClient, formatter } = deps;
      const projectPath = resolve(pathArg);

      // Resolve config: CLI flag > process.env > .env file > undefined
      const dotEnv = loadDotEnvFiles(projectPath, process.cwd());
      try {
        const result = await mechaUp(dockerClient, {
          projectPath,
          port: cmdOpts.port ? parseInt(cmdOpts.port, 10) : undefined,
          claudeToken: cmdOpts.claudeToken ?? process.env["CLAUDE_CODE_OAUTH_TOKEN"] ?? dotEnv["CLAUDE_CODE_OAUTH_TOKEN"],
          anthropicApiKey: cmdOpts.anthropicKey ?? process.env["ANTHROPIC_API_KEY"] ?? dotEnv["ANTHROPIC_API_KEY"],
          otp: cmdOpts.otp ?? process.env["MECHA_OTP"] ?? dotEnv["MECHA_OTP"],
          permissionMode: cmdOpts.permissionMode,
        });
        formatter.success("Mecha started successfully.");
        formatter.info(`  ID:   ${result.id}`);
        formatter.info(`  Port: ${result.port}`);
        formatter.info(`  Auth: ${cmdOpts.showToken ? result.authToken : result.authToken.slice(0, 8) + "..."}`);
        formatter.info(`  Name: ${result.name}`);
      } catch (err) {
        formatter.error(toUserMessage(err));
        process.exitCode = toExitCode(err);
      }
    });
}
```

### 5.6 Dashboard Migration Example: `POST /api/mechas`

**After** (~25 lines):
```typescript
import { NextResponse, type NextRequest } from "next/server";
import { mechaLs, mechaUp } from "@mecha/service";
import { toHttpStatus, toUserMessage } from "@mecha/contracts";
import { getDockerClient } from "@/lib/docker";
import { withAuth } from "@/lib/api-auth";

export const GET = withAuth(async () => {
  const client = getDockerClient();
  const mechas = await mechaLs(client);
  return NextResponse.json(mechas);
});

export const POST = withAuth(async (request: NextRequest) => {
  const client = getDockerClient();
  try {
    const body = await request.json();
    const result = await mechaUp(client, body);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: toUserMessage(err) }, { status: toHttpStatus(err) });
  }
});
```

**Note**: Dashboard POST no longer needs the `withCreationLock` mutex — Docker handles port allocation.

### 5.7 Dashboard Logs Route (Justified Exception)

The logs route at `packages/dashboard/src/app/api/mechas/[id]/logs/route.ts` will be longer than other routes (~85 lines) because it handles Docker multiplexed binary frame parsing and SSE framing. This is transport-layer code, not business logic. The service layer provides the raw stream; the dashboard route shapes it for SSE delivery to the browser.

### 5.8 New CLI Command: `mecha configure`

**File**: `packages/cli/src/commands/configure.ts`

```typescript
import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { mechaConfigure } from "@mecha/service";
import { toUserMessage, toExitCode } from "@mecha/contracts";

export function registerConfigureCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("configure <id>")
    .description("Update runtime configuration of a Mecha")
    .option("--claude-token <token>", "Claude OAuth token")
    .option("--anthropic-key <key>", "Anthropic API key")
    .option("--otp <secret>", "TOTP secret")
    .option("--permission-mode <mode>", "Permission mode: default, plan, full-auto")
    .action(async (id: string, cmdOpts) => {
      const { dockerClient, formatter } = deps;
      try {
        await mechaConfigure(dockerClient, {
          id,
          claudeToken: cmdOpts.claudeToken,
          anthropicApiKey: cmdOpts.anthropicKey,
          otp: cmdOpts.otp,
          permissionMode: cmdOpts.permissionMode,
        });
        formatter.success(`Mecha '${id}' reconfigured.`);
      } catch (err) {
        formatter.error(toUserMessage(err));
        process.exitCode = toExitCode(err);
      }
    });
}
```

Register in `packages/cli/src/program.ts`.

### 5.9 Files Changed

**New files**:

| File | Purpose |
|------|---------|
| `packages/service/package.json` | Package manifest: deps on contracts, docker, core |
| `packages/service/tsconfig.json` | References: core, contracts, docker |
| `packages/service/vitest.config.ts` | 100% coverage gates |
| `packages/service/src/index.ts` | Public API |
| `packages/service/src/service.ts` | All 15 service functions |
| `packages/service/src/env.ts` | Pure .env loading |
| `packages/service/__tests__/service.test.ts` | Unit tests for all functions |
| `packages/service/__tests__/env.test.ts` | .env loading tests |
| `packages/cli/src/commands/configure.ts` | New configure command |
| `packages/cli/__tests__/commands/configure.test.ts` | Configure tests |

**Modified files**:

| File | Change |
|------|--------|
| `packages/cli/package.json` | Add dep: `@mecha/service`, `@mecha/contracts` |
| `packages/cli/src/commands/up.ts` | Thin wrapper calling `mechaUp()` |
| `packages/cli/src/commands/rm.ts` | Thin wrapper calling `mechaRm()` |
| `packages/cli/src/commands/lifecycle.ts` | Thin wrapper calling `mechaStart/Stop/Restart()` |
| `packages/cli/src/commands/ls.ts` | Thin wrapper calling `mechaLs()` |
| `packages/cli/src/commands/status.ts` | Thin wrapper calling `mechaStatus()` (watch loop stays in CLI) |
| `packages/cli/src/commands/logs.ts` | Thin wrapper calling `mechaLogs()` (stdout piping stays in CLI) |
| `packages/cli/src/commands/doctor.ts` | Thin wrapper calling `mechaDoctor()` |
| `packages/cli/src/commands/init.ts` | Thin wrapper calling `mechaInit()` |
| `packages/cli/src/commands/ui.ts` | Thin wrapper calling `resolveUiUrl()`. Remove `resolveHostPort` export. |
| `packages/cli/src/commands/mcp.ts` | Thin wrapper calling `resolveMcpEndpoint()`. Remove import from `ui.ts`. |
| `packages/cli/src/commands/exec.ts` | Thin wrapper calling `mechaExec()` |
| `packages/cli/src/program.ts` | Register `configure` command |
| `packages/dashboard/package.json` | Add dep: `@mecha/service`, `@mecha/contracts` |
| `packages/dashboard/src/app/api/mechas/route.ts` | Thin wrapper; delete `withCreationLock`, `validateEnv`, `VALID_PERMISSION_MODES` |
| `packages/dashboard/src/app/api/mechas/[id]/route.ts` | Thin wrapper; delete `VALID_PERMISSION_MODES`, inline validation |
| `packages/dashboard/src/app/api/mechas/[id]/start/route.ts` | Thin wrapper |
| `packages/dashboard/src/app/api/mechas/[id]/stop/route.ts` | Thin wrapper |
| `packages/dashboard/src/app/api/mechas/[id]/restart/route.ts` | Thin wrapper |
| `packages/dashboard/src/app/api/doctor/route.ts` | Thin wrapper |
| `vitest.workspace.ts` | Add `service` project |
| `vitest.config.ts` | Add `service` to coverage thresholds |
| `tsconfig.json` | Add `service` reference |
| `turbo.json` | No change needed (generic build task) |

### 5.10 Acceptance Criteria

- [ ] `packages/service/` exists with all 15 functions
- [ ] Every service function has typed input (no `raw: unknown`)
- [ ] CLI commands contain no Docker calls (except `dashboard.ts` which spawns a process)
- [ ] Dashboard routes contain no Docker calls (except logs SSE framing which uses the raw stream)
- [ ] `withCreationLock` mutex deleted from dashboard
- [ ] `VALID_PERMISSION_MODES` only exists in `@mecha/contracts`
- [ ] `BLOCKED_ENV_KEYS` only exists in `@mecha/contracts`
- [ ] `process.env` is never mutated in `mecha up` flow
- [ ] New `mecha configure` command works with `--claude-token`, `--anthropic-key`, `--otp`, `--permission-mode`
- [ ] `anthropicApiKey` supported in both `mechaUp` and `mechaConfigure`
- [ ] Dynamic port works: `mecha up ./project` (no -p) gets Docker-assigned port
- [ ] Explicit port works: `mecha up ./project -p 7700` binds to 7700
- [ ] `pnpm test && pnpm test:coverage && pnpm typecheck` pass
- [ ] Integration tests pass with new code paths (`INTEGRATION=true pnpm test:integration`)

---

## 6. Phase 5: Cleanup (Non-Breaking)

**Goal**: Remove dead code. Document known limitations.

**Merge checkpoint**: Final green gates.

### 6.1 Delete Dead Packages

**Pre-deletion check** (must pass before deleting):
```bash
# Verify no code imports from these packages
grep -r "@mecha/ui" packages/ --include="*.ts" --include="*.tsx" --include="*.json"
grep -r "@mecha/hub" packages/ --include="*.ts" --include="*.tsx" --include="*.json"
```

**Delete**: `packages/ui/` (entire directory), `packages/hub/` (entire directory)

**Config updates**:

| File | Change |
|------|--------|
| `turbo.json` | Remove `@mecha/ui#build` task (lines 12-15) |
| `pnpm-workspace.yaml` | No change (uses `packages/*` glob) |
| `tsconfig.json` | Remove `ui` and `hub` references if present |

### 6.2 Document Known Limitations in `AGENTS.md`

Add section:

```markdown
## Known Limitations

### Dashboard Sessions
Dashboard stores sessions in-memory (`packages/dashboard/src/lib/auth.ts`).
This is single-process only. If multi-instance deployment is needed, replace with signed JWT or Redis sessions.

### Security Trust Boundary
Secrets (CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_API_KEY, MECHA_OTP) are passed as container environment variables.
This is acceptable when Docker socket access is controlled. Document that anyone with Docker socket access can read container env.

### Port Assignment
Default port assignment uses Docker-native allocation. Ports are not guaranteed to be in the 7700-7799 range.
Use `--port` / request body `port` field for deterministic assignment.
```

### 6.3 Acceptance Criteria

- [ ] `packages/ui/` deleted, no references remain
- [ ] `packages/hub/` deleted, no references remain
- [ ] `turbo.json` updated (removed `@mecha/ui#build`)
- [ ] Known limitations documented in `AGENTS.md`
- [ ] `pnpm test && pnpm test:coverage && pnpm typecheck && pnpm build` pass

---

## 7. Deferred Work (Not Part of This Rewrite)

| Enhancement | Trigger to Start |
|-------------|-----------------|
| Event bus (Docker events or external broker) | Polling latency > 5s becomes a UX problem |
| SQLite: wire lifecycle into runtime `main.ts` | When runtime persistence is needed for production |
| SQLite: migration versioning | After DB lifecycle is wired |
| SQLite: backup/export (`VACUUM INTO`) | When users request data portability |
| Agent-to-agent communication | When multi-mecha orchestration use cases are defined |
| Dashboard signed sessions (JWT/Redis) | When multi-instance deployment is needed |
| Centralized log aggregation | When > 5 concurrent mechas is common |

---

## 8. Complete File Manifest

### New Files (16)

| File | Phase | Package |
|------|-------|---------|
| `packages/contracts/package.json` | 1 | contracts |
| `packages/contracts/tsconfig.json` | 1 | contracts |
| `packages/contracts/vitest.config.ts` | 1 | contracts |
| `packages/contracts/src/index.ts` | 1 | contracts |
| `packages/contracts/src/schemas.ts` | 1 | contracts |
| `packages/contracts/src/errors.ts` | 1 | contracts |
| `packages/contracts/__tests__/schemas.test.ts` | 1 | contracts |
| `packages/contracts/__tests__/errors.test.ts` | 1 | contracts |
| `packages/docker/__tests__/integration/lifecycle.test.ts` | 3 | docker |
| `packages/service/package.json` | 4 | service |
| `packages/service/tsconfig.json` | 4 | service |
| `packages/service/vitest.config.ts` | 4 | service |
| `packages/service/src/index.ts` | 4 | service |
| `packages/service/src/service.ts` | 4 | service |
| `packages/service/src/env.ts` | 4 | service |
| `packages/cli/src/commands/configure.ts` | 4 | cli |

### Modified Files (25+)

| File | Phase | Change |
|------|-------|--------|
| `vitest.workspace.ts` | 1, 3, 4 | Add contracts, integration, service projects |
| `vitest.config.ts` | 1, 4 | Add contracts, service to coverage |
| `tsconfig.json` | 1, 4 | Add contracts, service references |
| `packages/runtime/src/server.ts` | 1 | Token logging fix |
| `packages/docker/src/container.ts` | 2 | `hostPort` optional, `getContainerPort()` |
| `packages/docker/src/index.ts` | 2 | Export `getContainerPort` |
| `packages/cli/src/commands/up.ts` | 2, 4 | Rollback (P2), thin wrapper (P4) |
| `packages/dashboard/src/app/api/mechas/route.ts` | 2, 4 | Rollback (P2), thin wrapper (P4) |
| `packages/dashboard/src/app/api/mechas/[id]/route.ts` | 2, 4 | PATCH rollback (P2), thin wrapper (P4) |
| `packages/cli/package.json` | 4 | Add deps: service, contracts |
| `packages/dashboard/package.json` | 4 | Add deps: service, contracts |
| `packages/cli/src/commands/rm.ts` | 4 | Thin wrapper |
| `packages/cli/src/commands/lifecycle.ts` | 4 | Thin wrapper |
| `packages/cli/src/commands/ls.ts` | 4 | Thin wrapper |
| `packages/cli/src/commands/status.ts` | 4 | Thin wrapper (watch loop stays) |
| `packages/cli/src/commands/logs.ts` | 4 | Thin wrapper (stdout pipe stays) |
| `packages/cli/src/commands/doctor.ts` | 4 | Thin wrapper |
| `packages/cli/src/commands/init.ts` | 4 | Thin wrapper |
| `packages/cli/src/commands/ui.ts` | 4 | Thin wrapper, remove `resolveHostPort` export |
| `packages/cli/src/commands/mcp.ts` | 4 | Thin wrapper |
| `packages/cli/src/commands/exec.ts` | 4 | Thin wrapper |
| `packages/cli/src/program.ts` | 4 | Register configure command |
| `packages/dashboard/src/app/api/mechas/[id]/start/route.ts` | 4 | Thin wrapper |
| `packages/dashboard/src/app/api/mechas/[id]/stop/route.ts` | 4 | Thin wrapper |
| `packages/dashboard/src/app/api/mechas/[id]/restart/route.ts` | 4 | Thin wrapper |
| `packages/dashboard/src/app/api/doctor/route.ts` | 4 | Thin wrapper |
| `package.json` | 3 | Add `test:integration` script |
| `turbo.json` | 5 | Remove `@mecha/ui#build` |
| `AGENTS.md` | 5 | Add known limitations section |

### Deleted Files (Phase 5)

| Path | Reason |
|------|--------|
| `packages/ui/` (entire directory) | Superseded by dashboard |
| `packages/hub/` (entire directory) | Empty stub |
