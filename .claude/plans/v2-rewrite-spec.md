# mecha.im v2 — Implementation Spec

> Date: 2026-02-21
> Status: Draft
> Based on: review in `.claude/plans/rewrite-review.md`

---

## 1. Target Architecture

### Package Structure

```
@mecha/core      — types, constants, errors, Zod schemas, ID generation, TOTP (pure, zero deps except zod)
@mecha/docker    — thin Docker client wrapper (connect, container CRUD, image, network, volume)
@mecha/service   — NEW: business logic layer, consumes docker + core
@mecha/runtime   — container-side Fastify server (agent SDK, MCP, auth middleware)
@mecha/cli       — thin wrapper: parse args → call service → format output
@mecha/dashboard — thin wrapper: parse HTTP → call service → format response
```

**Deleted**: `packages/ui/`, `packages/hub/`

### Dependency DAG

```
                  ┌─── @mecha/cli
core → docker → service ─┤
                  └─── @mecha/dashboard

core → runtime  (independent, runs inside container)
```

No package may import from a sibling at the same level or above. Runtime never imports from docker/service/cli/dashboard.

### Key Decisions (Resolved)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| TOTP location | Stay in `@mecha/core` | Dashboard and runtime both use it |
| Port allocation | Docker-native (`HostPort: "0"`) + post-start inspect; `--port` override | Eliminates race conditions, no custom allocator |
| Event bus | Deferred; use polling via Docker API | In-memory emitter can't cross processes |
| Validation | Zod schemas in `@mecha/core`, used by service layer | Single source of truth |
| Error model | Typed error classes in `@mecha/core` with code/status/exit mappings | Shared across CLI and dashboard |
| .env loading | Pure function returning `Record<string, string>`, no process.env mutation | Service layer, opt-in via `loadDotEnv: true` |
| Migration strategy | Direct branch-and-merge with tests, no feature flags | ~3.5K LOC codebase, not worth adapter layers |

---

## 2. Specs by Phase

### Phase 1: Define Contracts

**Goal**: Establish shared schemas, error types, and config precedence before any refactoring.

#### 1.1 Zod Schemas (add to `@mecha/core`)

```typescript
// packages/core/src/schemas.ts

import { z } from "zod";

export const PERMISSION_MODES = ["default", "plan", "full-auto"] as const;
export const PermissionMode = z.enum(PERMISSION_MODES);
export type PermissionMode = z.infer<typeof PermissionMode>;

export const MechaUpInput = z.object({
  projectPath:    z.string().min(1),
  port:           z.number().int().min(1024).max(65535).optional(),
  claudeToken:    z.string().optional(),
  otp:            z.string().optional(),
  permissionMode: PermissionMode.optional(),
  env:            z.array(z.string()).optional(),
  loadDotEnv:     z.boolean().default(false),
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
  id:             z.string().min(1),
  claudeToken:    z.string().optional(),
  otp:            z.string().optional(),
  permissionMode: PermissionMode.optional(),
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
  id:        z.string(),
  name:      z.string(),
  state:     z.string(),
  port:      z.number().optional(),
  path:      z.string(),
  image:     z.string(),
  createdAt: z.string().optional(),
  startedAt: z.string().optional(),
});
export type MechaStatusResult = z.infer<typeof MechaStatusResult>;

export const DoctorResult = z.object({
  dockerAvailable: z.boolean(),
  networkExists:   z.boolean(),
  issues:          z.array(z.string()),
});
export type DoctorResult = z.infer<typeof DoctorResult>;
```

#### 1.2 Error Types (add to `@mecha/core/src/errors.ts`)

```typescript
// Add these to existing error hierarchy:

export class InvalidPortError extends MechaError {
  constructor(port: number) {
    super(`Invalid port: ${port} (must be 1024-65535)`, "INVALID_PORT");
  }
}

export class InvalidPermissionModeError extends MechaError {
  constructor(mode: string) {
    super(`Invalid permission mode: ${mode} (must be one of: default, plan, full-auto)`, "INVALID_PERMISSION_MODE");
  }
}

export class ContainerStartError extends MechaError {
  constructor(name: string, cause?: Error) {
    super(`Failed to start container: ${name}`, "CONTAINER_START_FAILED");
    if (cause) this.cause = cause;
  }
}

export class PathNotFoundError extends MechaError {
  constructor(path: string) {
    super(`Path does not exist: ${path}`, "PATH_NOT_FOUND");
  }
}
```

#### 1.3 Error Mapping Table

| Error Class | CLI Exit Code | HTTP Status | User Message |
|-------------|---------------|-------------|--------------|
| `PathNotFoundError` | 1 | 400 | Path does not exist: {path} |
| `InvalidPortError` | 1 | 400 | Invalid port: {port} (must be 1024-65535) |
| `InvalidPermissionModeError` | 1 | 400 | Invalid permission mode: {mode} |
| `ContainerNotFoundError` | 1 | 404 | Container not found: {name} |
| `ContainerStartError` | 1 | 500 | Failed to start container: {name} |
| `DockerNotAvailableError` | 1 | 503 | Docker is not available |
| `MechaError` (generic) | 1 | 500 | {message} |
| `ZodError` (validation) | 1 | 400 | Validation error: {formatted issues} |

Implement as helper functions:

```typescript
// packages/core/src/errors.ts
export function toHttpStatus(err: unknown): number { ... }
export function toExitCode(err: unknown): number { ... }
export function toUserMessage(err: unknown): string { ... }
```

#### 1.4 Config Precedence (highest wins)

```
1. Explicit CLI flag / HTTP request body field  (highest)
2. Environment variable (process.env)
3. .env file in project directory
4. .env file in cwd (if different from project dir)
5. Default value from schema                    (lowest)
```

Service layer receives already-resolved values. CLI/dashboard handle precedence before calling service.

#### Acceptance Criteria (Phase 1)

- [ ] `packages/core/src/schemas.ts` exists with all schemas above
- [ ] `VALID_PERMISSION_MODES` removed from cli/up.ts, dashboard/route.ts, runtime/casa.ts — replaced by `PermissionMode` from schemas
- [ ] Error classes added with `toHttpStatus()`, `toExitCode()`, `toUserMessage()` helpers
- [ ] All schemas have corresponding `z.infer` types exported
- [ ] `pnpm test && pnpm test:coverage && pnpm typecheck` pass
- [ ] Existing behavior unchanged (additive only)

---

### Phase 2: Fix Transactional Safety

**Goal**: Fix multi-step operation failures that leave orphaned resources.

#### 2.1 Container Create+Start Rollback

In both CLI `up` and dashboard `POST /api/mechas`, wrap the sequence:

```typescript
const container = await createContainer(client, opts);
try {
  await startContainer(client, containerName);
} catch (startErr) {
  // Rollback: remove the orphaned container
  try { await removeContainer(client, containerName, true); } catch { /* best effort */ }
  throw new ContainerStartError(containerName, startErr as Error);
}
```

#### 2.2 Dashboard Reconfigure Rollback

In `PATCH /api/mechas/[id]`, the current flow is: stop → remove → recreate → start. If recreate or start fails, the mecha is gone. Fix:

```typescript
// 1. Inspect current container (save config for rollback)
const original = await inspectContainer(client, containerName);
// 2. Stop
await stopContainer(client, containerName);
// 3. Remove + Recreate + Start
try {
  await removeContainer(client, containerName);
  await createContainer(client, newOpts);
  await startContainer(client, containerName);
} catch (err) {
  // Rollback: recreate with original config
  try {
    await createContainer(client, originalOpts);
    await startContainer(client, containerName);
  } catch { /* log rollback failure, surface original error */ }
  throw err;
}
```

#### Acceptance Criteria (Phase 2)

- [ ] `mecha up` cleans up container if start fails (test: mock startContainer to throw)
- [ ] Dashboard POST cleans up container if start fails
- [ ] Dashboard PATCH rolls back on recreate/start failure
- [ ] Tests cover all rollback paths
- [ ] `pnpm test && pnpm test:coverage && pnpm typecheck` pass

---

### Phase 3: Integration Tests

**Goal**: Lock current behavior with tests against real Docker before refactoring.

#### 3.1 Test Setup

```typescript
// packages/service/__tests__/integration/setup.ts
import { beforeAll, afterAll } from "vitest";

const SKIP = !process.env.INTEGRATION;

beforeAll(async () => {
  if (SKIP) return;
  // Verify Docker is available
  // Pull test image if needed
  // Create test network
});

afterAll(async () => {
  if (SKIP) return;
  // Remove all test containers (label: mecha-test=true)
  // Remove test network
});
```

#### 3.2 Test Cases

| Test | Verifies |
|------|----------|
| Create + start + inspect + stop + remove | Full lifecycle |
| Create with explicit port → inspect shows that port | Port binding |
| Create with `HostPort: "0"` → inspect shows allocated port | Dynamic port |
| Create succeeds, start fails → container removed | Rollback |
| Two containers → `ls` returns both | Listing |
| Exec command → output captured | Exec |
| Logs streaming → output received | Logs |

#### 3.3 CI Integration

```yaml
# Add to CI pipeline (when it exists)
env:
  INTEGRATION: "true"
steps:
  - run: pnpm test:integration
```

Root `package.json` script:
```json
"test:integration": "INTEGRATION=true vitest run --project integration"
```

#### Acceptance Criteria (Phase 3)

- [ ] Integration test suite exists and passes locally with `INTEGRATION=true`
- [ ] Tests are skipped by default (no `INTEGRATION` env)
- [ ] At least 7 test cases covering the table above
- [ ] Cleanup: all test containers/networks removed after suite
- [ ] `pnpm test` (unit) still passes independently

---

### Phase 4: Extract `@mecha/service`

**Goal**: Single service layer that CLI and dashboard both call. No business logic in either consumer.

#### 4.1 Package Setup

```
packages/service/
  package.json          # @mecha/service, deps: @mecha/core, @mecha/docker
  tsconfig.json         # extends base, references core + docker
  vitest.config.ts      # 100% coverage gates
  src/
    index.ts            # public API re-exports
    service.ts          # all service functions
    env.ts              # pure .env file loading
  __tests__/
    service.test.ts
    env.test.ts
```

#### 4.2 Service Functions

Every function takes `(client: DockerClient, input: <ZodType>)` and returns a typed result or throws a typed error.

```typescript
// packages/service/src/service.ts

export async function mechaUp(client: DockerClient, raw: unknown): Promise<MechaUpResult> {
  const input = MechaUpInput.parse(raw);
  // 1. Validate path exists
  // 2. Compute ID, container name, volume name
  // 3. Load .env if input.loadDotEnv (pure, no process.env mutation)
  // 4. Ensure network + volume
  // 5. Build env array (auth token, claude token, otp, permission mode)
  // 6. Create container (port: input.port ?? 0 for Docker-native)
  // 7. Start container (with rollback on failure)
  // 8. If dynamic port: inspect to get actual port
  // 9. Return { id, name, port, authToken }
}

export async function mechaRm(client: DockerClient, raw: unknown): Promise<void> { ... }
export async function mechaStart(client: DockerClient, id: string): Promise<void> { ... }
export async function mechaStop(client: DockerClient, id: string): Promise<void> { ... }
export async function mechaRestart(client: DockerClient, id: string): Promise<void> { ... }
export async function mechaLs(client: DockerClient): Promise<MechaLsItem[]> { ... }
export async function mechaStatus(client: DockerClient, id: string): Promise<MechaStatusResult> { ... }
export async function mechaLogs(client: DockerClient, raw: unknown): Promise<NodeJS.ReadableStream> { ... }
export async function mechaExec(client: DockerClient, raw: unknown): Promise<{ exitCode: number; output: string }> { ... }
export async function mechaConfigure(client: DockerClient, raw: unknown): Promise<void> { ... }
export async function mechaDoctor(client: DockerClient): Promise<DoctorResult> { ... }
export async function mechaInit(client: DockerClient): Promise<void> { ... }
export async function mechaResolveUrl(client: DockerClient, id: string): Promise<string> { ... }
```

#### 4.3 Pure .env Loading

```typescript
// packages/service/src/env.ts

export function loadDotEnvFiles(projectPath: string, cwd: string): Record<string, string> {
  const result: Record<string, string> = {};
  const dirs = [...new Set([projectPath, cwd])];
  for (const dir of dirs) {
    // Read .env, parse KEY=VALUE lines, skip comments
    // Later dirs don't override earlier ones
    // Never touches process.env
  }
  return result;
}
```

#### 4.4 CLI Migration (per command)

Before:
```typescript
// up.ts — 120 lines of business logic
export function registerUpCommand(parent: Command, deps: CommandDeps): void {
  parent.command("up <path>").action(async (pathArg, cmdOpts) => {
    // 80+ lines of validation, Docker calls, env building...
  });
}
```

After:
```typescript
// up.ts — ~20 lines, thin wrapper
import { mechaUp } from "@mecha/service";

export function registerUpCommand(parent: Command, deps: CommandDeps): void {
  parent.command("up <path>")
    .option("-p, --port <port>", "Host port")
    .option("--claude-token <token>", "Claude OAuth token")
    .option("--otp <secret>", "TOTP secret")
    .option("--permission-mode <mode>", "Permission mode")
    .option("--show-token", "Print full auth token")
    .action(async (pathArg, cmdOpts) => {
      try {
        const result = await mechaUp(deps.dockerClient, {
          projectPath: resolve(pathArg),
          port: cmdOpts.port ? parseInt(cmdOpts.port, 10) : undefined,
          claudeToken: cmdOpts.claudeToken,
          otp: cmdOpts.otp,
          permissionMode: cmdOpts.permissionMode,
          loadDotEnv: true,
        });
        deps.formatter.success("Mecha started successfully.");
        deps.formatter.info(`  ID:   ${result.id}`);
        deps.formatter.info(`  Port: ${result.port}`);
        deps.formatter.info(`  Auth: ${cmdOpts.showToken ? result.authToken : result.authToken.slice(0, 8) + "..."}`);
      } catch (err) {
        deps.formatter.error(toUserMessage(err));
        process.exitCode = toExitCode(err);
      }
    });
}
```

#### 4.5 Dashboard Migration (per route)

Before: 155 lines with inline Docker calls, validation, mutex.
After: ~30 lines calling service functions.

```typescript
// dashboard/src/app/api/mechas/route.ts
import { mechaLs, mechaUp } from "@mecha/service";
import { toHttpStatus, toUserMessage } from "@mecha/core";

export const GET = withAuth(async () => {
  const client = getDockerClient();
  const mechas = await mechaLs(client);
  return NextResponse.json(mechas);
});

export const POST = withAuth(async (request: NextRequest) => {
  const client = getDockerClient();
  try {
    const body = await request.json();
    const result = await mechaUp(client, { ...body, loadDotEnv: false });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: toUserMessage(err) }, { status: toHttpStatus(err) });
  }
});
```

#### 4.6 Port Assignment Change in `@mecha/docker`

Update `CreateContainerOptions` to support dynamic port:

```typescript
export interface CreateContainerOptions {
  // ... existing fields ...
  hostPort?: number;  // was required `number`, now optional
}

// In createContainer():
PortBindings: {
  [`${DEFAULTS.CONTAINER_PORT}/tcp`]: [
    { HostIp: "127.0.0.1", HostPort: opts.hostPort ? String(opts.hostPort) : "0" },
  ],
},
```

Add inspect helper to resolve actual port:

```typescript
export async function getContainerPort(client: DockerClient, name: string): Promise<number> {
  const info = await inspectContainer(client, name);
  const bindings = info.NetworkSettings.Ports[`${DEFAULTS.CONTAINER_PORT}/tcp`];
  if (!bindings?.[0]?.HostPort) throw new MechaError("No port binding found", "NO_PORT_BINDING");
  return parseInt(bindings[0].HostPort, 10);
}
```

#### Acceptance Criteria (Phase 4)

- [ ] `packages/service/` exists with all 14 service functions
- [ ] All CLI commands are < 30 lines each (thin wrappers)
- [ ] All dashboard routes are < 40 lines each (thin wrappers)
- [ ] Dashboard mutex (`withCreationLock`) deleted — Docker handles port allocation
- [ ] `VALID_PERMISSION_MODES` exists only in `@mecha/core/src/schemas.ts`
- [ ] `process.env` is never mutated in `mecha up` flow
- [ ] New `mecha configure` CLI command exists (feature parity with dashboard PATCH)
- [ ] `pnpm test && pnpm test:coverage && pnpm typecheck` pass
- [ ] Integration tests pass (same behavior, new code paths)

---

### Phase 5: Cleanup

**Goal**: Remove dead code and fix remaining issues.

#### 5.1 Delete Dead Packages

Before deleting, verify no references:

```bash
grep -r "packages/ui" pnpm-workspace.yaml turbo.json tsconfig.json
grep -r "@mecha/ui" packages/
grep -r "packages/hub" pnpm-workspace.yaml turbo.json tsconfig.json
```

Then remove `packages/ui/` and `packages/hub/`. Update workspace config.

#### 5.2 Security Fixes

| Fix | Location | Change |
|-----|----------|--------|
| Don't log auth token to stdout | `runtime/src/server.ts:34` | Log only first 8 chars, or log to file only |
| Document trust boundary | `AGENTS.md` or `SECURITY.md` | Secrets in container env require Docker socket access control |

#### 5.3 Dashboard Session Safety

Document that dashboard in-memory sessions (`dashboard/src/lib/auth.ts`) are single-process only. If multi-instance is needed later, add Redis or signed JWT sessions.

#### Acceptance Criteria (Phase 5)

- [ ] `packages/ui/` and `packages/hub/` deleted
- [ ] No references to deleted packages in workspace config
- [ ] Auth token no longer fully logged
- [ ] `pnpm test && pnpm test:coverage && pnpm typecheck && pnpm build` pass

---

### Phase 6 (Deferred): Future Enhancements

These are tracked but NOT part of the current rewrite:

| Enhancement | Trigger to Start |
|-------------|-----------------|
| Event bus (Docker events or external broker) | When polling latency > 5s becomes a UX problem |
| SQLite migration versioning | When runtime DB is wired into `main.ts` and used in production |
| SQLite backup/export | When users request data portability |
| Agent-to-agent communication | When multi-mecha orchestration use cases are defined |
| Centralized log aggregation | When > 5 concurrent mechas is a common pattern |

---

## 3. Files Changed Summary

### New Files

| File | Package | Purpose |
|------|---------|---------|
| `packages/core/src/schemas.ts` | core | Zod schemas for all operations |
| `packages/service/package.json` | service | Package manifest |
| `packages/service/tsconfig.json` | service | TypeScript config |
| `packages/service/vitest.config.ts` | service | Test + coverage config |
| `packages/service/src/index.ts` | service | Public API |
| `packages/service/src/service.ts` | service | All service functions |
| `packages/service/src/env.ts` | service | Pure .env loading |
| `packages/service/__tests__/service.test.ts` | service | Unit tests |
| `packages/service/__tests__/env.test.ts` | service | Env loading tests |
| `packages/cli/src/commands/configure.ts` | cli | New configure command |

### Modified Files

| File | Change |
|------|--------|
| `packages/core/src/errors.ts` | Add error classes + mapping helpers |
| `packages/core/src/index.ts` | Export schemas + new errors |
| `packages/docker/src/container.ts` | Make `hostPort` optional, add `getContainerPort()` |
| `packages/docker/src/index.ts` | Export new function |
| `packages/cli/src/commands/up.ts` | Thin wrapper over `mechaUp()` |
| `packages/cli/src/commands/rm.ts` | Thin wrapper over `mechaRm()` |
| `packages/cli/src/commands/lifecycle.ts` | Thin wrapper over start/stop/restart |
| `packages/cli/src/commands/ls.ts` | Thin wrapper over `mechaLs()` |
| `packages/cli/src/commands/status.ts` | Thin wrapper over `mechaStatus()` |
| `packages/cli/src/commands/logs.ts` | Thin wrapper over `mechaLogs()` |
| `packages/cli/src/commands/doctor.ts` | Thin wrapper over `mechaDoctor()` |
| `packages/cli/src/commands/init.ts` | Thin wrapper over `mechaInit()` |
| `packages/cli/src/commands/ui.ts` | Thin wrapper over `mechaResolveUrl()` |
| `packages/cli/src/commands/mcp.ts` | Thin wrapper over `mechaResolveUrl()` |
| `packages/cli/src/commands/exec.ts` | Thin wrapper over `mechaExec()` |
| `packages/cli/src/program.ts` | Register configure command |
| `packages/dashboard/src/app/api/mechas/route.ts` | Thin wrapper over service |
| `packages/dashboard/src/app/api/mechas/[id]/route.ts` | Thin wrapper over service |
| `packages/dashboard/src/app/api/mechas/[id]/start/route.ts` | Thin wrapper |
| `packages/dashboard/src/app/api/mechas/[id]/stop/route.ts` | Thin wrapper |
| `packages/dashboard/src/app/api/mechas/[id]/restart/route.ts` | Thin wrapper |
| `packages/dashboard/src/app/api/mechas/[id]/logs/route.ts` | Thin wrapper |
| `packages/dashboard/src/app/api/doctor/route.ts` | Thin wrapper |
| `packages/runtime/src/server.ts` | Don't log full auth token |
| `pnpm-workspace.yaml` | Add service, remove ui/hub |
| `turbo.json` | Add service build task |
| `vitest.workspace.ts` | Add service test workspace |
| `tsconfig.json` | Add service reference |

### Deleted Files

| File | Reason |
|------|--------|
| `packages/ui/` (entire directory) | Superseded by dashboard |
| `packages/hub/` (entire directory) | Empty stub |
