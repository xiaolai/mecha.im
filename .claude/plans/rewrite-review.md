# mecha.im — Rewrite Review & Improvement Proposal

> Date: 2026-02-21
> Author: Claude Code (Opus 4.6)
> Status: Draft — pending Codex review

## Context

mecha.im is a local-first multi-agent runtime where each Mecha is a containerized CASA (Claude Agent SDK App) instance. The project is a pnpm monorepo with 7 packages: core, docker, cli, runtime, dashboard, ui, hub.

## What's Already Good

1. **Deterministic ID generation** — `mx-<slug>-<hash>` from SHA256 of resolved path

2. **Security-hardened containers** — readonly root, CAP\_DROP ALL, non-root user, isolated /tmp

3. **Branded types** (`MechaId`) — prevents accidental string misuse at compile time

4. **CLI DI pattern** (`CommandDeps`) — clean testability, no globals

5. **100% coverage gates** — enforced on core, docker, cli, runtime packages

6. **CLI-first development** — enforced by rules, not just conventions

## Critical Issues Found

### Issue 1: Duplicated Business Logic (CLI vs Dashboard)

The same operations are independently implemented in:

- `packages/cli/src/commands/up.ts` (lines 82-121)

- `packages/dashboard/src/app/api/mechas/route.ts` (lines 99-153)

They drift apart:

- `VALID_PERMISSION_MODES` defined in **3 separate places** (cli/up.ts, dashboard/route.ts, runtime/casa.ts)

- Port allocation: CLI requires explicit port, Dashboard auto-allocates

- `.env` loading: CLI has it, Dashboard doesn't

- `PATCH /configure`: Dashboard has it, CLI lacks it entirely

- Token resolution: slightly different fallback chains

### Issue 2: Dead/Redundant Packages

- `packages/ui/` (24K) — earlier prototype superseded by `packages/dashboard/` (136K). Uses older `@assistant-ui/react@0.10` vs dashboard's `0.12`.

- `packages/hub/` — empty stub, no source files

### Issue 3: Wrong Package Boundaries

- TOTP auth logic lives in `@mecha/core` but is only used by `@mecha/runtime`

- The planned service layer would bloat `@mecha/docker` beyond its purpose (low-level Docker ops)

- No clear separation between "host-side" and "container-side" concerns

### Issue 4: Hand-Rolled Mutex for Port Allocation

`packages/dashboard/src/app/api/mechas/route.ts` lines 6-12 implement a promise-chain mutex. This:

- Only works within a single Node.js process

- Breaks with multiple dashboard instances or serverless deployment

- Is fragile and untested

### Issue 5: Global process.env Mutation

`packages/cli/src/commands/up.ts` lines 63-81 load `.env` files by mutating `process.env` globally. Side effects persist across the process lifetime and affect unrelated code.

### Issue 6: No Error Recovery on Multi-Step Operations

If `createContainer` succeeds but `startContainer` fails (up.ts:102-111), an orphaned container is left behind. No cleanup path exists.

### Issue 7: Scattered Validation Logic

- Dashboard: hand-rolled `validateEnv()`, manual type checks

- Runtime: Zod schemas for MCP

- CLI: manual `parseInt` and `if` checks

- No shared validation schemas

### Issue 8: Testing Depth vs Coverage

100% line coverage but many tests only verify mock call signatures. They test wiring, not behavior. No integration tests against real Docker. Mutation testing configured but disabled (`requireMutation: false`).

### Issue 9: No Multi-Mecha Coordination

Each mecha is fully isolated. The only discovery mechanism is polling (`mecha ls`). Missing:

- Agent-to-agent communication

- Event broadcasting

- Centralized log aggregation

- Orchestration patterns

### Issue 10: SQLite in Readonly Container

Runtime uses SQLite with WAL mode but runs in a readonly root filesystem container. State depends on specific volume mount paths. No migration versioning beyond `001-init.ts`. No backup/export capability.

## Proposed Architecture (Rewrite)

### Package Structure

```
@mecha/core     — types, constants, errors, ID generation (pure, zero deps)
@mecha/service  — NEW: business logic, Zod schemas, all operations
@mecha/docker   — thin Docker client wrapper (stays small, no business logic)
@mecha/runtime  — container-side server (owns TOTP, agent, MCP)
@mecha/cli      — thin wrapper: parse args → call service → format output
@mecha/dashboard — thin wrapper: parse HTTP → call service → format response
```

Delete: `packages/ui/`, `packages/hub/`

### Dependency DAG

```
core → docker → service → cli
                        → dashboard
core → runtime (independent, runs inside container)
```

### Key Changes

1. **Service layer** (`@mecha/service`) owns ALL business logic:

   - `mechaUp(opts)`, `mechaRm(id, opts)`, `mechaLs()`, `mechaStatus(id)`

   - `mechaStart(id)`, `mechaStop(id)`, `mechaRestart(id)`

   - `mechaConfigure(id, opts)`, `mechaDoctor()`, `mechaInit()`

   - `mechaLogs(id, opts)`, `mechaExec(id, cmd)`, `mechaResolveUrl(id)`

   - `allocatePort(requestedPort?)` — uses Docker-native assignment or proper locking

2. **Zod schemas** in service layer for all inputs:

   ```typescript
   export const MechaUpInput = z.object({
     projectPath: z.string().min(1),
     port: z.number().int().min(1024).max(65535).optional(),
     claudeToken: z.string().optional(),
     otp: z.string().optional(),
     permissionMode: z.enum(["default", "plan", "full-auto"]).optional(),
     env: z.array(z.string()).optional(),
     loadDotEnv: z.boolean().default(false),
   });
   ```

3. **Pure env resolution** — `loadDotEnvFiles(projectPath)` returns `Record<string, string>`, never mutates `process.env`

4. **Error recovery** — `mechaUp` wraps create+start in try-catch, removes container on start failure

5. **Event bus** — `MechaEventEmitter` in service layer for start/stop/error events. Dashboard subscribes via WebSocket, CLI via `--watch`.

6. **Integration tests** — test suite that creates real containers (gated behind `INTEGRATION=true` env var)

## Priority Order

| # | Change                                       | Impact                  | Effort  |
| - | -------------------------------------------- | ----------------------- | ------- |
| 1 | Extract `@mecha/service` with Zod schemas    | Fixes issues 1, 4, 5, 7 | Large   |
| 2 | Delete `packages/ui/` and `packages/hub/`    | Fixes issue 2           | Trivial |
| 3 | Move TOTP to runtime, fix package boundaries | Fixes issue 3           | Medium  |
| 4 | Add error recovery to multi-step ops         | Fixes issue 6           | Small   |
| 5 | Add integration tests                        | Fixes issue 8           | Medium  |
| 6 | Add event bus for multi-mecha coordination   | Fixes issue 9           | Large   |
| 7 | Proper SQLite migration versioning + export  | Fixes issue 10          | Medium  |

---

## Codex Review (gpt-5.3-codex, high reasoning effort)

**Verdict**: NEEDS REVISION

### Dimension 1: Internal Consistency

| # | Severity | Finding                                                                                                                                                        | Location                                                                                                | Recommendation                                                                                                               |
| - | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1 | High     | Plan says TOTP in `@mecha/core` is runtime-only, but dashboard auth/login and chat proxy also depend on core TOTP helpers.                                     | Issue 3, `dashboard/src/app/api/auth/login/route.ts`, `dashboard/src/app/api/mechas/[id]/chat/route.ts` | Keep crypto primitives in `@mecha/core` (or new shared auth package); move only runtime-specific auth middleware to runtime. |
| 2 | High     | Proposed "runtime owns TOTP" conflicts with dashboard remaining a thin host-side wrapper. Dashboard must verify OTP and generate OTP headers today.            | Package structure, `runtime/src/auth/token.ts`, `dashboard/src/app/api/auth/login/route.ts`             | Define clear split: shared TOTP lib in host-safe package; runtime owns auth enforcement only.                                |
| 3 | Med      | Duplication claim partially inaccurate: runtime doesn't define `VALID_PERMISSION_MODES`; it uses a map. Another duplicate in dashboard `[id]` route is missed. | Issue 1, `runtime/src/agent/casa.ts:11`, `dashboard/src/app/api/mechas/[id]/route.ts:9`                 | Correct inventory first; create one shared permission-mode schema/constant.                                                  |
| 4 | Med      | `allocatePort` decision internally unresolved: "Docker-native assignment or proper locking" are materially different designs.                                  | Key change #1                                                                                           | Make one primary strategy and one fallback, with acceptance criteria per strategy.                                           |
| 5 | Med      | Issue 10 says runtime "uses SQLite" operationally, but current runtime entrypoint never initializes DB/migrations.                                             | Issue 10, `runtime/src/main.ts`, `runtime/src/db/sqlite.ts`                                             | Reframe as "latent/partial DB subsystem" rather than active production dependency.                                           |

### Dimension 2: Completeness

| # | Severity | Finding                                                                                                                                         | Location                                                        | Recommendation                                                                          |
| - | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1 | High     | No shared error model specified for service APIs (domain errors vs transport errors), so CLI and dashboard mappings are undefined.              | Service layer section                                           | Define typed errors and mapping tables (CLI exit code, HTTP status, user message).      |
| 2 | High     | Recovery only described for `mechaUp`; other multi-step flows (dashboard PATCH recreate path) still lack rollback.                              | Key change #4, `dashboard/src/app/api/mechas/[id]/route.ts:124` | Add transactional semantics for all lifecycle operations.                               |
| 3 | High     | Port assignment migration path missing: if Docker chooses port dynamically, downstream discoverability (`ls`, `status`, UI URL) is unspecified. | Key change #1, `cli/src/commands/ui.ts`                         | Specify canonical source for runtime port and expose consistently in service responses. |
| 4 | Med      | No incremental migration strategy (compatibility between old CLI/dashboard and new service package).                                            | Overall rewrite section                                         | Add phased rollout with feature flags and temporary adapter layer.                      |
| 5 | Med      | Event bus lifecycle and delivery guarantees undefined (startup order, backpressure, disconnect, replay).                                        | Key change #5                                                   | Define event contract: topics, durability, ordering, replay, process boundary.          |
| 6 | Med      | Config precedence rules incomplete (`--opts` vs request body vs `.env` vs process env).                                                         | Key changes #2/#3                                               | Publish explicit precedence matrix and test cases.                                      |

### Dimension 3: Feasibility

| # | Severity | Finding                                                                                                                      | Location                                                   | Recommendation                                                                             |
| - | -------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1 | High     | In-memory event emitter cannot coordinate CLI and dashboard if they run in separate processes.                               | Key change #5                                              | Either keep polling, or use Docker events / external broker for real cross-process events. |
| 2 | High     | Moving TOTP out of core into runtime is not feasible without introducing bad dependency from dashboard to runtime.           | Priority #3                                                | Keep TOTP in shared package; do not push into runtime-only package.                        |
| 3 | Med      | Docker-native port assignment feasible, but current API assumes `hostPort: number` and callers assume chosen port pre-start. | `docker/src/container.ts:14`, `cli/src/commands/up.ts:108` | Update container API to support dynamic port mode + post-start inspect step.               |
| 4 | Med      | SQLite improvements feasible, but DB path/lifecycle not integrated in runtime startup — work is detached.                    | `runtime/src/main.ts`, `runtime/src/db/sqlite.ts`          | First wire DB lifecycle into runtime startup/shutdown, then add versioning/export.         |
| 5 | Low      | Removing `packages/ui`/`packages/hub` likely feasible, but plan should confirm no scripts/docs/tooling rely on them.         | Priority #2, `pnpm-workspace.yaml`                         | Add repository-wide reference check as acceptance criterion before deletion.               |

### Dimension 4: Ambiguity

| # | Severity | Finding                                                                                                 | Location                                                      | Recommendation                                                            |
| - | -------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1 | High     | "Docker-native assignment or proper locking" leaves implementers with two incompatible interpretations. | Key change #1                                                 | Decide one now; document exact algorithm and failure mode.                |
| 2 | High     | Event bus described without concrete protocol or transport boundaries.                                  | Key change #5                                                 | Provide minimal API spec (event name, payload schema, consumer behavior). |
| 3 | Med      | Service operation list has no input/output schema per operation except one `MechaUpInput` example.      | Service layer section                                         | Define full contract table for all service methods.                       |
| 4 | Med      | Integration test gate env var (`INTEGRATION=true`) doesn't align with existing patterns in repo.        | Key change #6, `runtime/__tests__/integration/docker.test.ts` | Standardize one env var and document in root scripts.                     |
| 5 | Med      | SQLite "backup/export capability" named but format, trigger, restore path, and retention undefined.     | Issue 10 / Priority #7                                        | Specify concrete backup design and restore workflow.                      |

### Dimension 5: Risk & Sequencing

| # | Severity | Finding                                                                                                                        | Location       | Recommendation                                                                                     |
| - | -------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------- | -------------------------------------------------------------------------------------------------- |
| 1 | High     | Highest-risk refactor (service extraction) scheduled first, before stabilizing with integration tests and rollback guarantees. | Priority #1/#5 | Start with behavior-locking tests + transactional bug fixes, then extract service with confidence. |
| 2 | High     | TOTP boundary move sequenced early despite unresolved host/container auth ownership.                                           | Priority #3    | Defer boundary move until auth architecture is explicitly settled.                                 |
| 3 | Med      | Event bus introduced before proving polling limitations — risk of unnecessary complexity.                                      | Priority #6    | Keep polling MVP, measure pain, then decide bus based on concrete SLOs.                            |
| 4 | Med      | Deleting packages early can remove fallback paths while rewrite is in progress.                                                | Priority #2    | Defer deletion until replacement paths are validated.                                              |

### Top 3 Risks

1. **Cross-process coordination assumptions are wrong** — an in-memory event emitter cannot serve as a system event bus across CLI and dashboard processes.

2. **TOTP relocation would break dashboard auth** — dashboard imports TOTP from core today; pushing it to runtime creates an impossible dependency.

3. **Large structural refactor sequenced before behavior-locking tests** — extracting a service layer without integration tests risks introducing regressions with no safety net.

### Strongest Aspects

- Correctly identifies real drift between CLI and dashboard provisioning paths

- Correctly flags global `process.env` mutation and missing create/start cleanup

- Good instinct to keep `@mecha/docker` thin and centralize validation/business rules elsewhere

- Good emphasis on schema-driven validation and integration testing

### Codex Answers to Questions

**Q1: Agree with issues? Others missed?**
Yes on most, but Issue 3 (TOTP placement) and Issue 10 (SQLite) are overstated. Missed issues: lack of rollback in dashboard reconfigure path (`dashboard/src/app/api/mechas/[id]/route.ts:124`), in-memory auth sessions not multi-instance safe (`dashboard/src/lib/auth.ts`), and token/secrets lifecycle concerns.

**Q2: ****`@mecha/service`**** or keep logic in ****`@mecha/docker`****?**
`@mecha/service` is the right abstraction. Keep `@mecha/docker` as a low-level adapter only.

**Q3: Docker-native port (****`HostPort: "0"`****) or custom allocator?**
Prefer Docker-native by default for correctness and race elimination. Keep explicit `--port` override. Only build custom allocator if you need a constrained fixed range with shared locking.

**Q4: Event bus now, or polling?**
Polling is sufficient now. Add event bus only after proving polling can't meet responsiveness/scale requirements.

**Q5: SQLite persistence approach?**
Integrate DB lifecycle into runtime startup first, then add migration table/versioning, then export/backup (`VACUUM INTO` or snapshot API), then tune WAL/checkpointing and retention.

**Q6: Security concerns not flagged?**

- `MECHA_AUTH_TOKEN` logged when auto-generated (`runtime/src/server.ts:34`)

- Dashboard stores sessions in-memory only (`dashboard/src/lib/auth.ts`) — not multi-instance safe

- Secrets carried in container env (acceptable with Docker access controls, but should be documented as trust boundary)

**Q7: Different priorities if rewriting from scratch?**

1. Define service contracts/errors/schemas first

2. Fix transactional lifecycle safety (rollback/cleanup) and port assignment race

3. Add integration/contract tests that lock behavior

4. Extract `@mecha/service` behind adapters

5. Defer eventing and SQLite enhancement until core lifecycle/API are stable

---

## Synthesis: Claude Code Assessment

After reviewing Codex's feedback, here's where I agree, disagree, and what the revised plan should be.

### Agreements (Codex is right)

1. **TOTP must stay in a shared package.** I was wrong to propose moving it to runtime. Dashboard uses it for login and chat proxy auth. The fix is to keep TOTP in `@mecha/core` (or a new `@mecha/auth` package) and only move the *middleware* to runtime.

2. **Port strategy must be decided now, not left ambiguous.** Docker-native `HostPort: "0"` + post-start inspect is the correct default. Explicit `--port` is the override. No custom allocator needed.

3. **Sequencing is wrong.** The original plan puts the biggest refactor first. Codex's ordering is better:

   - First: lock behavior with tests + fix transactional safety

   - Then: extract service layer with confidence

   - Last: eventing, SQLite enhancements

4. **Event bus is premature.** An in-memory EventEmitter can't cross process boundaries. Polling via Docker API is the pragmatic choice. Docker's own event stream (`docker events`) could serve as a future event source.

5. **Error model is a real gap.** The plan has no error-to-HTTP-status or error-to-exit-code mapping table. This must be defined before the service layer.

### Disagreements (Where I push back)

1. **"Phased rollout with feature flags" is over-engineering.** This is a small team project with \~3.5K lines of code. A clean branch-and-merge with tests is sufficient — no need for adapter layers or feature flags.

2. **Issue 10 (SQLite) is not overstated.** Even if the DB isn't wired into `main.ts` yet, the code exists, tests exist, and it *will* be integrated. Flagging it early is correct. The fact that it's "latent" makes it *more* concerning, not less — dead code that looks production-ready is a trap.

### Revised Priority Order

| #  | Change                                                                                                       | Rationale                        |
| -- | ------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| 1  | **Define service contracts** — Zod schemas, error types, error mapping table for all operations              | Foundation for everything else   |
| 2  | **Fix transactional lifecycle safety** — rollback on create+start failure, rollback on dashboard reconfigure | Small, high-impact bug fixes     |
| 3  | **Add integration tests** (gated behind `INTEGRATION=true`)                                                  | Behavior-locking before refactor |
| 4  | **Extract ****`@mecha/service`** with schemas from step 1                                               | The big refactor, now safe       |
| 5  | **Port assignment: Docker-native default** + `--port` override + post-start inspect                          | Eliminates mutex hack and race   |
| 6  | **Fix process.env mutation** — pure env resolution in service layer                                          | Clean side-effect removal        |
| 7  | **Delete ****`packages/ui/`**** and ****`packages/hub/`** after reference check               | Cleanup                          |
| 8  | **Keep TOTP in ****`@mecha/core`**, extract auth middleware only                                        | Correct boundary                 |
| 9  | **SQLite: wire lifecycle, add migration versioning**                                                         | When runtime matures             |
| 10 | **Event bus** — only when polling proves insufficient                                                        | Deferred                         |

### New Issues to Track (Found by Codex)

- **Dashboard in-memory sessions** (`dashboard/src/lib/auth.ts`) — not multi-instance safe

- **Dashboard reconfigure lacks rollback** (`dashboard/src/app/api/mechas/[id]/route.ts:124`)

- **Auth token logged to stdout** on auto-generation (`runtime/src/server.ts:34`)

- **Config precedence undefined** — `--flag` vs `request.body` vs `.env` vs `process.env`

