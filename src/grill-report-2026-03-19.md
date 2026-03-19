---
plugin: grill
version: 1.2.0
date: 2026-03-19
target: src/
style: Select All (Architecture Review + Hard-Nosed Critique + Multi-Perspective Panel + ADR Style + Paranoid Mode)
addons: [scale-stress, hidden-costs, principle-violations, strangler-fig, success-metrics, before-vs-after, assumptions-audit, compact-optimize]
agents: [recon, architecture, error-handling, security, testing, edge-cases]
---

# Grill Report: `src/` (Mecha CLI + Native Runtime)

**Codebase**: 33 TypeScript files, 5,723 LOC
**Stack**: Node.js, Commander CLI, Hono HTTP, Dockerode, Zod, MCP SDK
**Architecture**: CLI + singleton daemon + HTTP dashboard + MCP proxy, dual-runtime (Docker + Native)

---

## Style 1: Architecture Review + Rewrite Plan

### Current Architecture

```
CLI (cli.ts 543L)
  |
  +-> ProcessManager (process-manager.ts 54L)
  |     |-> DockerAdapter -> docker.ts (473L) -> dockerode
  |     +-> NativeManager -> native.ts (300L) -> child_process
  |
  +-> Store (store.ts 260L) -- registry.json + mecha.json
  +-> Auth (auth.ts 175L) -- credentials.yaml
  +-> Config (config.ts 66L) -- bot.yaml (Zod validated)

Daemon (daemon.ts 330L)
  |-> Reconciler (30s loop)
  +-> Dashboard Server (dashboard-server.ts 899L)
        |-> Fleet API (/api/fleet/*)
        |-> Dashboard API (/api/bots/*)
        |-> Bot Proxy (/bot/:name/*)
        |-> Office API (/api/office/*)
        |-> WebSocket PTY Proxy
        +-> Static SPA

MCP Proxy (mcp-proxy.ts 207L) -- stdio bridge
```

### Key Redesign Decisions

1. **Decompose dashboard-server.ts** (899 LOC god function) into 5 route modules
2. **Extract shared bot utilities** from `docker.utils.ts` -- native runtime should not import `docker.*` modules
3. **Unify env builder** -- Docker and Native both construct bot env vars independently with duplicated logic
4. **Add cross-process file lock** to spawn lifecycle, not just registry writes
5. **Use socket remote address** instead of trusting X-Forwarded-For for auth decisions

### What to Keep

- ProcessManager strategy pattern -- clean, well-applied
- Zod schema validation at every I/O boundary
- Atomic write pattern (tmp + fsync + rename)
- MechaError hierarchy with defError factory
- Directory-based lock with stale detection (daemon lock)
- SSE streaming for bot query responses
- Commander CLI structure with register*Command delegation

---

## Style 2: Hard-Nosed Critique + Roadmap

### Critical Flaws

| # | Flaw | Evidence | Impact |
|---|------|----------|--------|
| 1 | **XFF spoofing bypasses all IP-based security** | `dashboard-server.ts:80`, `dashboard-server-utils.ts:88` | TOTP brute-force + unauthenticated dashboard access |
| 2 | **Cross-process spawn race** | `native.ts:80` mutex is in-process only; CLI + daemon can spawn same bot simultaneously | Orphan processes, port conflicts, corrupted registry |
| 3 | **Credentials world-readable** | `docker.utils.ts:238` writes 0o644, parent dirs 0o777 | API key theft on shared hosts |
| 4 | **Fleet API routes missing error handling** | `dashboard-server.ts:161-197` -- no try/catch unlike sister routes | Stack trace leakage, 500s |
| 5 | **Native runtime has zero tests** | `native.ts`, `native.utils.ts`, `process-manager.ts` -- 471 LOC untested | Process lifecycle bugs undetectable |

### 80/20 Rewrite Plan

Don't rewrite. The architecture is fundamentally sound. Focus on:
1. **Security hardening** (XFF, permissions, timing) -- 2 days
2. **dashboard-server.ts decomposition** -- 1 day
3. **Cross-process locking for spawn** -- 1 day
4. **Test coverage for native runtime** -- 2 days

### Prioritized Backlog (Top 15)

| # | Item | Impact | Risk | Effort | Score |
|---|------|--------|------|--------|-------|
| 1 | Fix XFF trust -- use socket remote address | 10 | 10 | 2h | 50 |
| 2 | Add cross-process file lock to spawn | 9 | 9 | 4h | 20 |
| 3 | Credentials file 0o600 + fix container access | 9 | 8 | 2h | 36 |
| 4 | Add try/catch to fleet API routes | 8 | 7 | 1h | 56 |
| 5 | Add global Hono onError handler | 7 | 7 | 30m | 98 |
| 6 | Native runtime unit tests | 8 | 9 | 8h | 9 |
| 7 | ProcessManager routing tests | 7 | 8 | 2h | 28 |
| 8 | Daemon reconciler tests | 7 | 7 | 4h | 12 |
| 9 | Decompose dashboard-server.ts | 6 | 4 | 6h | 4 |
| 10 | WebSocket timing-safe token compare | 6 | 6 | 15m | 144 |
| 11 | Unify env builder (Docker/Native) | 5 | 3 | 4h | 4 |
| 12 | Extract bot-utils from docker.utils | 5 | 2 | 3h | 3 |
| 13 | daemon.json atomic writes | 4 | 3 | 15m | 48 |
| 14 | TOTP timing-safe comparison | 5 | 5 | 15m | 100 |
| 15 | Reconciler backoff for crash-looping bots | 5 | 4 | 3h | 7 |

### Quick Wins

**< 1 day:**
- Fix WebSocket timing-safe comparison (15 min)
- Fix TOTP timing-safe comparison (15 min)
- Add global Hono onError handler (30 min)
- Add try/catch to fleet API routes (1 hour)
- daemon.json atomic writes (15 min)
- Add uncaughtException handler to daemon (30 min)
- Log warnings in listAllBots catch blocks (15 min)

**< 1 week:**
- Fix XFF trust chain (2 hours)
- Fix credentials permissions (2 hours)
- Cross-process spawn lock (4 hours)
- Native runtime tests (8 hours)
- Decompose dashboard-server.ts (6 hours)

### Red Flags

1. The `MECHA_FLEET_INTERNAL_SECRET` is shared across all bots -- any compromised bot can control the entire fleet
2. No rate limiting on any API endpoint except TOTP (and that's bypassable)
3. Session cookie lacks `Secure` flag -- transmits in plaintext over HTTP
4. PID reuse can cause SIGKILL to wrong process -- no process identity verification

---

## Style 3: Multi-Perspective Panel

### Staff Backend Engineer

**Top 3 Changes:**
1. **Add cross-process file lock around entire spawn lifecycle** -- The in-process mutex is a false safety blanket. CLI and daemon are separate processes. Use the existing directory-lock pattern from store.ts. Risk: lock contention on rapid spawns.
2. **Decompose dashboard-server.ts into route modules** -- 899 LOC single function with 13 concerns. Extract fleet, bots, auth, office, proxy routes. Risk: none (pure refactor).
3. **Unify env builder** -- `buildContainerEnv` and `buildNativeEnv` duplicate 60% of logic. Extract shared `buildBotEnv()`. Risk: subtle env differences between runtimes need careful testing.

### Security Engineer

**Top 3 Changes:**
1. **Stop trusting X-Forwarded-For** -- Use `req.socket.remoteAddress` for all auth decisions. The current code lets any network client claim to be localhost. Risk: breaks deployments behind reverse proxies unless configurable.
2. **Fix credentials file permissions** -- 0o644 for API keys is unacceptable. Use 0o600. Fix container access via Docker user namespace or s6 fix-attrs. Risk: container permission issues (test Docker path).
3. **Add timing-safe comparison everywhere** -- WebSocket auth (dashboard-server.ts:837) and TOTP verification (shared/totp.ts:76) use `===`. Risk: none.

### SRE / Operations

**Top 3 Changes:**
1. **Add reconciler backoff** -- A crash-looping bot generates a restart attempt every 30 seconds forever. Add exponential backoff per bot with max 5-minute interval. Risk: delayed recovery for transient failures.
2. **Add daemon crash handler** -- No `uncaughtException`/`unhandledRejection` in daemon process. Crash leaves stale lock + state files. Risk: none.
3. **SSE stream shared polling** -- Each SSE client triggers its own `listAllBots()` every 5 seconds. With N clients, that's N Docker API calls/5s. Share a single poll with fan-out. Risk: added complexity.

### Performance Engineer

**Top 3 Changes:**
1. **SSE fan-out architecture** -- Per-client polling is O(N) in Docker API calls. Single poll + broadcast to all clients. Risk: stale data on write-through.
2. **File descriptor leak in native spawn** -- `logStream` not closed on happy path. Accumulates fd per bot over daemon lifetime. Risk: fd exhaustion after many spawn/restart cycles.
3. **`logs` tail reads entire file** -- Fixed in recent audit but verify `tail -200` is actually used in current code.

### Product Engineer

**Top 3 Changes:**
1. **Dashboard `guardBusy` UX** -- Stopping a crashed bot requires `force=true`. The dashboard should show a clear "Bot is unresponsive, force stop?" dialog. Risk: none.
2. **Session persistence** -- Daemon restart logs out all dashboard users. Consider file-backed sessions or signed cookies. Risk: added complexity.
3. **Runtime indicator in `mecha ls`** -- Show Docker vs Native in the table output. Risk: none.

### Junior Dev Advocate

**Top 3 Changes:**
1. **Extract shared test harness** -- Every test file copy-pastes the same 15-line test runner. Extract to `test/helpers.ts`. Risk: none.
2. **Rename docker.constants.ts** -- Native code imports from `docker.constants.ts` which is confusing. Rename to `constants.ts`. Risk: trivial import updates.
3. **Add code coverage** -- `npx c8 npm test` gives instant coverage reporting. Risk: none.

### Unified Plan

All panels agree on: XFF fix, credentials permissions, cross-process spawn lock, dashboard decomposition. The security and SRE priorities should come first (security + resilience), then architecture cleanup (decomposition + DRY), then DX (tests, naming, coverage).

---

## Style 4: ADR Style

### ADR-1: Use Socket Remote Address Instead of X-Forwarded-For

**Context**: The dashboard server uses `x-forwarded-for` header to determine client IP for TOTP rate limiting and loopback auto-session bootstrap. This header is trivially spoofable when no reverse proxy is present. The daemon defaults to binding on `127.0.0.1` but can be configured with `--host 0.0.0.0`.

**Decision**: Use `req.socket.remoteAddress` (available via Hono's `c.env.incoming` or a custom middleware). Only trust `x-forwarded-for` when an explicit `MECHA_TRUSTED_PROXY` env var is set.

**Alternatives**: (a) Always trust XFF (current, insecure). (b) Never trust XFF (breaks reverse proxy deployments). (c) Configurable trust (chosen).

**Consequences**: Deployments behind nginx/Caddy must set `MECHA_TRUSTED_PROXY=true`. Existing loopback-only deployments are unaffected.

**Migration**: Add middleware that resolves real IP. Update `shouldBootstrapDashboardSession` and TOTP rate limiter. 2 hours.

### ADR-2: Cross-Process File Lock for Bot Lifecycle

**Context**: The in-process `Mutex` in `shared/mutex.ts` only serializes within a single Node.js process. CLI and daemon are separate processes that can both spawn bots. The registry's directory-based lock only protects JSON writes, not the full spawn lifecycle (port allocation, process creation, health check).

**Decision**: Wrap the entire spawn/start/stop/restart/remove lifecycle in a per-bot directory-based cross-process lock (`~/.mecha/bots/<name>/.lifecycle.lock`), using the same pattern as the registry lock.

**Alternatives**: (a) In-process mutex only (current, races between processes). (b) Advisory file lock via `flock` (not available in pure Node.js). (c) Registry lock expanded to cover lifecycle (too coarse-grained, blocks all bots).

**Consequences**: Slightly slower spawn/stop operations (lock acquisition). CLI will block if daemon is mid-operation on the same bot. Prevents orphan processes and port conflicts.

**Migration**: Create `withBotLifecycleLock(name, fn)` in a shared module. Wrap `_spawn`, `stop`, `restart`, `remove` in both Docker and Native managers. 4 hours.

### ADR-3: Decompose dashboard-server.ts

**Context**: `dashboard-server.ts` is 899 LOC with 13 distinct concerns in a single function. It handles fleet API, dashboard API, bot proxy, office simulation, WebSocket proxy, TOTP, auth, and static serving.

**Decision**: Extract route groups into separate modules under `src/routes/`: `fleet.ts`, `bots.ts`, `auth.ts`, `office.ts`, `proxy.ts`. Keep `dashboard-server.ts` as composition root (~100 LOC).

**Alternatives**: (a) Keep as-is (current, hard to navigate). (b) Split by HTTP method (not meaningful). (c) Split by auth domain (chosen, natural boundaries).

**Consequences**: Better code navigation, smaller diffs on changes, clearer ownership. No behavior change.

**Migration**: Extract one route group at a time, verify tests pass after each. 6 hours.

### ADR-4: Fix Credentials File Permissions

**Context**: `writeBotCredentials` writes credentials.yaml with 0o644 (world-readable). Parent dirs are 0o777. This was changed from 0o600 to support Docker container access (container runs as UID 10001, host creates as current user).

**Decision**: Write credentials with 0o600. Use Docker's `--user $(id -u):$(id -g)` to match host UID, or use the s6 fix-attrs script that already runs at container startup to chown files.

**Alternatives**: (a) Keep 0o644 (current, insecure on shared hosts). (b) Use Docker volumes with UID mapping. (c) Use s6 fix-attrs (already in Dockerfile, just needs credentials path added).

**Consequences**: Container must run as host UID or s6 must fix permissions at startup. Native mode is unaffected (same user).

**Migration**: Change permissions in `writeBotCredentials`, verify container can still read. 2 hours.

### ADR-5: Reconciler Backoff for Crash-Looping Bots

**Context**: The daemon reconciler attempts to restart any bot with `desired_state=running` every 30 seconds. A bot in a crash loop (bad config, missing auth) generates infinite restart attempts with no backoff.

**Decision**: Track per-bot failure count. Apply exponential backoff: 30s, 60s, 120s, 300s max. Reset count on successful start. Store failure count in registry entry (new field `restart_failures`).

**Alternatives**: (a) No backoff (current, wastes resources). (b) Disable bot after N failures (too aggressive). (c) Exponential backoff with cap (chosen).

**Consequences**: Persistently failing bots don't consume resources. Users can manually trigger restart to reset backoff. Dashboard shows backoff status.

**Migration**: Add `restart_failures` to registry schema. Update reconciler. 3 hours.

### ADR-6: Shared SSE Poll with Fan-Out

**Context**: Each SSE client connection to `/api/office/stream` spawns its own `setInterval` that calls `listAllBots()` every 5 seconds. With N clients, this generates N Docker API calls per 5 seconds.

**Decision**: Single shared poll interval with broadcast to all connected clients.

**Alternatives**: (a) Per-client polling (current, O(N) API calls). (b) Event-driven via Docker events API (complex, Docker-specific). (c) Shared poll (chosen, simple).

**Consequences**: All clients see the same snapshot (consistent). Single Docker API call per interval regardless of client count.

**Migration**: Extract poll logic into a shared `OfficePollManager` class. 2 hours.

### ADR-7: Add Native Runtime Tests

**Context**: `native.ts` (300 LOC), `native.utils.ts` (117 LOC), and `process-manager.ts` (54 LOC) have zero test coverage. These manage real OS processes and are the most likely source of production bugs.

**Decision**: Add unit tests for utilities (PID file ops, isProcessAlive, buildNativeEnv, pickPort) and integration tests for ProcessManager routing.

**Alternatives**: (a) No tests (current, high risk). (b) Full integration tests spawning real agents (slow, requires agent code). (c) Unit tests + mocked integration tests (chosen).

**Consequences**: Catches regressions in process lifecycle. buildNativeEnv secret stripping is verified. ~80% coverage of new code.

**Migration**: Create `test/t21-native.ts` and `test/t22-process-manager.ts`. 8 hours.

### ADR-8: PID Identity Verification

**Context**: `isProcessAlive` uses `process.kill(pid, 0)` which only checks if *any* process with that PID exists. On PID reuse, the daemon may send SIGKILL to an unrelated process or fail to restart a dead bot.

**Decision**: Write process start time alongside PID in the PID file. Verify both PID and start time before signaling.

**Alternatives**: (a) PID only (current, vulnerable to PID reuse). (b) PID + cmdline check via `/proc/<pid>/cmdline` (Linux-only). (c) PID + start time (portable, chosen).

**Consequences**: PID reuse detected within 1 clock-tick resolution. False negative only if OS assigns same PID to a process that started at the exact same millisecond.

**Migration**: Update `writePidFile` to write `pid:startTime`, update `readPidFile` and `isProcessAlive`. 2 hours.

---

## Style 5: Paranoid Mode (Edge Case Gauntlet)

### Edge Case Risk Matrix

| Risk | Scenario | Likelihood | Impact | Component | File |
|------|----------|-----------|--------|-----------|------|
| **CRITICAL** | Cross-process spawn race -- CLI + daemon spawn same bot simultaneously, orphan processes | Medium | High | native.ts, mutex.ts | native.ts:80 |
| **CRITICAL** | XFF spoofing bypasses TOTP rate limit -- unlimited brute-force | Medium | High | dashboard-server.ts | :80 |
| **CRITICAL** | Credentials 0o644 + dirs 0o777 -- API keys readable by any local user | Medium | High | docker.utils.ts | :238 |
| **HIGH** | Loopback auto-bootstrap spoofable via XFF -- unauthenticated dashboard access | Medium | High | dashboard-server-utils.ts | :88 |
| **HIGH** | PID reuse -- SIGKILL sent to wrong process | Low | High | native.utils.ts | :33 |
| **HIGH** | Settings lock force-steals on timeout -- concurrent writes corrupt mecha.json | Low | High | store.ts | :197 |
| **HIGH** | Lock dir removal causes two daemons simultaneously | Low | High | daemon.ts | :170 |
| **HIGH** | Unlocked registry reads in reconciler -- stale data decisions | High | Medium | store.ts | :118 |
| **MEDIUM** | SSE per-client polling -- O(N) Docker API calls | Medium | Medium | dashboard-server.ts | :728 |
| **MEDIUM** | Port TOCTOU -- 30s wasted on collision | Medium | Medium | native.ts | :35 |
| **MEDIUM** | Registry before health check -- zombie entry on crash | Medium | Medium | native.ts | :139 |
| **MEDIUM** | Unbounded in-memory Maps (sessions + rate limiter) | Low | Medium | dashboard-server-schema.ts | :10 |
| **MEDIUM** | Credentials R-M-W without lock -- lost entries | Low | Medium | auth.ts | :78 |
| **LOW** | Daemon restart destroys sessions | High | Low | dashboard-server-schema.ts | :10 |
| **LOW** | Avatar R-M-W race | Medium | Low | dashboard-server.ts | :684 |
| **LOW** | Docker restart stale containerId | Medium | Low | docker.ts | :190 |
| **LOW** | readState()! non-null assertion in shutdown | Low | Low | daemon.ts | :192 |

### Paranoid Verdict

**The single scariest thing**: The combination of cross-process spawn race + world-readable credentials. The in-process Mutex provides zero protection between CLI and daemon processes. A concurrent spawn creates a window where partially-constructed bot state directories (with 0o777 permissions and 0o644 credential files) are exposed. On any shared system, this means live API keys are readable by any local user during the spawn race window, with no audit trail.

---

## Add-On: Scale Stress

*"Assume traffic grows 100x and team doubles -- what breaks first?"*

1. **SSE polling breaks first** -- 100 SSE clients = 100 Docker API calls/5s = 20/s. At 100x users, that's 2000 calls/s to Docker daemon. Fix: shared poll with fan-out.
2. **Registry lock contention** -- 100 bots with 30s reconciler = 3.3 bot checks/s. Each check may acquire registry lock. CLI commands from doubled team compete. Fix: read-path doesn't need lock (already correct), but write batching would help.
3. **Port exhaustion** -- 100 native bots consume ports 3100-3199. Port scan starts at 3100 every time, re-checking all used ports. Fix: store last-used port, start from there.
4. **Dashboard server becomes bottleneck** -- Single-threaded Hono server handles fleet API + all bot proxying. Fix: cluster mode or separate bot-proxy process.

## Add-On: Hidden Costs

1. **Onboarding cost**: New developer must understand 3 lock mechanisms (registry, settings, daemon), 2 runtime paths, and which `docker.utils.ts` functions are actually runtime-agnostic. Estimated 2-day ramp.
2. **Debugging cost**: Native bot failures require manual `tail ~/.mecha/bots/<name>/logs/agent.log` -- no diagnostic output in spawn failure path (unlike Docker which dumps container logs).
3. **Operational cost**: No reconciler backoff means crash-looping bots generate continuous restart cycles, consuming health-check timeout (30s each) every 30s.
4. **Velocity cost**: dashboard-server.ts at 899 LOC means any route change requires understanding the full file's auth middleware chain and closure state.
5. **Testing cost**: Docker integration tests require Docker running and are excluded from CI. Native runtime is entirely untested. Bugs ship undetected.

## Add-On: Principle Violations

1. **SRP violation**: `dashboard-server.ts` has 13 responsibilities in one function.
2. **SRP violation**: `docker.utils.ts` mixes Docker-specific code with runtime-agnostic bot utilities.
3. **Dependency Inversion violation**: `native.ts` and `native.utils.ts` import from `docker.utils.ts` and `docker.constants.ts` -- the native runtime depends on Docker modules.
4. **Least Privilege violation**: Credentials written 0o644, state dirs 0o777 -- maximum permissions instead of minimum necessary.
5. **Least Privilege violation**: Fleet internal secret grants full fleet control to any bot -- no scoped permissions.

## Add-On: Strangler Fig

No big-bang rewrite needed. Incremental migration:

1. **Phase 1 (now)**: Extract `bot-utils.ts` from `docker.utils.ts`. Move `validateBotPath`, `copyHostCodexAuth`, `writeBotCredentials`, `withBotLock`, `ensureBotSshKey` to new module. Update imports. Zero behavior change.
2. **Phase 2 (next sprint)**: Extract dashboard route modules from `dashboard-server.ts`. One route group per PR. Test after each extraction.
3. **Phase 3 (following sprint)**: Add cross-process lifecycle lock. Wrap spawn in both runtimes. Add native runtime tests alongside.

## Add-On: Success Metrics

| Metric | Current | Target | How to Measure |
|--------|---------|--------|---------------|
| Test coverage (src/) | ~40% (estimated) | 80% | `npx c8 npm test` |
| Native runtime coverage | 0% | 80% | c8 per-file report |
| Max file LOC | 899 (dashboard-server.ts) | <300 | `wc -l` |
| Security findings (HIGH+) | 5 | 0 | This audit |
| P95 spawn latency | ~30s (health check timeout) | <5s | Instrument spawn |
| Daemon restart recovery time | Immediate (no backoff) | Exponential to 5min | Audit log analysis |
| CI test coverage | Fast suite only | Fast + Docker | CI run time |

## Add-On: Before vs After

**Before:**
```
CLI ──> docker.ts ──> dockerode
         |
         +──> docker.utils.ts (mixed concerns)
                |
Daemon ──> dashboard-server.ts (899L monolith)
                |
                +──> docker.ts
```

**After:**
```
CLI ──> process-manager.ts ──> docker.ts ──> dockerode
         |                 +──> native.ts ──> child_process
         |
         +──> bot-utils.ts (shared, runtime-agnostic)
         +──> env-builder.ts (shared env construction)

Daemon ──> dashboard-server.ts (100L composition root)
              |-> routes/fleet.ts
              |-> routes/bots.ts
              |-> routes/auth.ts
              |-> routes/office.ts
              +-> routes/proxy.ts
```

## Add-On: Assumptions Audit

| Assumption | Risk if Wrong | Validation Plan |
|-----------|---------------|----------------|
| Dashboard only accessed from localhost | HIGH -- XFF spoofing bypasses auth | Check `--host` usage in production configs |
| PID reuse is rare | MEDIUM -- SIGKILL to wrong process | Monitor PID space on target systems |
| Docker is always available | LOW -- native mode added as fallback | CI tests cover both paths |
| Single daemon per machine | HIGH -- two daemons corrupt state | Lock dir removal test |
| Bot names are globally unique | LOW -- registry enforces this | Validated by Zod schema |
| Health check timeout (30s) is sufficient | MEDIUM -- slow starts miss window | Instrument agent startup time |
| Credentials only need one auth profile per bot | LOW -- code enforces this | Config validation |

## Add-On: Compact & Optimize

1. **Deduplicate env builder** -- `buildContainerEnv` (docker.utils.ts:159-211, 52 LOC) and `buildNativeEnv` (native.utils.ts:46-105, 59 LOC) share ~60% logic. Extract shared `buildBotEnv()` -- saves ~35 LOC.
2. **Deduplicate SSE parsing** -- `mcp-proxy.ts:26-74` and `cli-utils.ts` both parse SSE streams. Extract shared parser -- saves ~30 LOC.
3. **Extract test harness** -- 13 test files duplicate identical 15-line test runner. Extract to `test/helpers.ts` -- saves ~180 LOC of test code.
4. **Merge `docker.types.ts` (14 LOC) into `process-manager.ts`** -- the separate file adds a redirect hop for one type and one interface.
5. **Merge `docker.constants.ts` (7 LOC) into `constants.ts`** or inline the 4 constants where used.
6. **Eliminate `cli-output.ts` (54 LOC)** -- it wraps picocolors with 3 helper functions. Inline or merge into `cli-utils.ts`.

**Estimated savings**: ~250 LOC source + ~180 LOC test boilerplate.

---

## Executive Summary

### One-Paragraph Verdict

The codebase is architecturally sound for its size -- the ProcessManager strategy pattern, Zod validation boundaries, atomic writes, and structured error hierarchy show thoughtful engineering. However, the security posture has serious gaps: X-Forwarded-For trust enables auth bypass, credentials are world-readable, and the fleet secret gives any compromised bot full fleet control. The native runtime was well-implemented but shipped with zero test coverage and a cross-process concurrency gap that the in-process mutex doesn't cover. The 899-LOC dashboard-server.ts monolith is the main maintenance drag. Overall: good bones, needs security hardening and test coverage before production use.

### Top 3 Actions

1. **Fix XFF trust + credentials permissions** (2-3 hours) -- These are exploitable NOW on any network-exposed or shared-host deployment. Use socket remote address, write credentials 0o600.
2. **Add cross-process lifecycle lock** (4 hours) -- The in-process mutex doesn't protect CLI-vs-daemon races. Without this, concurrent spawns can create orphan processes.
3. **Add native runtime tests** (8 hours) -- 471 LOC of untested process lifecycle code. The isProcessAlive EPERM fix, secret stripping in buildNativeEnv, and pickPort are all critical paths with zero verification.

### Confidence Levels

| Recommendation | Confidence | Would Increase |
|---------------|------------|---------------|
| Fix XFF trust | **High** -- trivially exploitable, verified in code | N/A |
| Cross-process lock needed | **High** -- in-process mutex confirmed per-process only | Reproduce with concurrent spawn test |
| Credentials permissions | **High** -- `ls -la` confirms 0o644 | N/A |
| dashboard-server decomposition | **Medium** -- beneficial but not urgent | Profile actual dev velocity impact |
| Reconciler backoff | **Medium** -- haven't confirmed crash-loop in practice | Test with a bot that always fails to start |
| SSE fan-out | **Low** -- theoretical scaling concern | Load test with 50+ SSE clients |

### Paranoid Verdict

**The single scariest thing found**: An attacker on the same network as a `--host 0.0.0.0` daemon sends `X-Forwarded-For: 127.0.0.1` to `GET /` and receives a full dashboard session cookie -- no password, no TOTP, no authentication whatsoever. They can then spawn, stop, remove, and reconfigure any bot in the fleet, read all bot configs including system prompts, and access the terminal proxy for interactive shell access to bot containers. This is a 1-request full compromise.

---

## Fixing Plan

### Phase 1: Critical fixes (do immediately)

1. **XFF trust -- use socket remote address**
   - Finding: Security #1, Edge Case #8, #20
   - Fix: Add middleware to resolve real IP from `req.socket.remoteAddress`. Only trust XFF when `MECHA_TRUSTED_PROXY` is set. Update `shouldBootstrapDashboardSession` and TOTP rate limiter.
   - Effort: 2 hours
   - Files: `src/dashboard-server.ts`, `src/dashboard-server-utils.ts`

2. **Cross-process lifecycle lock for spawn**
   - Finding: Edge Case #2, Architecture #3
   - Fix: Create `withBotLifecycleLock(name, fn)` using directory-based lock at `~/.mecha/bots/<name>/.lifecycle.lock`. Wrap `_spawn` in both Docker and Native managers.
   - Effort: 4 hours
   - Files: `src/native.ts`, `src/docker.ts`, new `src/bot-lifecycle-lock.ts`

3. **Credentials file permissions**
   - Finding: Security #3, Edge Case #11
   - Fix: Write credentials.yaml with 0o600. Add credentials path to s6 fix-attrs for Docker. Native mode already runs as same user.
   - Effort: 2 hours
   - Files: `src/docker.utils.ts`, `s6/` config

4. **Fleet API routes error handling**
   - Finding: Error Handling #1
   - Fix: Wrap all `/api/fleet/*` route handlers in try/catch with `safeError(c, err)`.
   - Effort: 1 hour
   - Files: `src/dashboard-server.ts`

5. **Global Hono error handler**
   - Finding: Error Handling #2
   - Fix: Add `app.onError()` that logs via structured logger and returns generic error.
   - Effort: 30 minutes
   - Files: `src/dashboard-server.ts`

### Phase 2: High-priority fixes (this sprint)

6. **WebSocket timing-safe token comparison**
   - Finding: Security #2
   - Fix: Replace `sessionToken !== DASHBOARD_TOKEN` with `constantTimeEquals`.
   - Effort: 15 minutes
   - Files: `src/dashboard-server.ts:837`

7. **TOTP timing-safe comparison**
   - Finding: Security #5
   - Fix: Use `timingSafeEqual` in `verifyTOTP`.
   - Effort: 15 minutes
   - Files: `shared/totp.ts:76`

8. **Daemon uncaughtException handler**
   - Finding: Error Handling #3
   - Fix: Register handlers that release lock, write audit log, clean state file.
   - Effort: 30 minutes
   - Files: `src/daemon.ts`

9. **daemon.json atomic writes**
   - Finding: Architecture #5
   - Fix: Replace `writeFileSync` with `atomicWriteJson`.
   - Effort: 15 minutes
   - Files: `src/daemon.ts:67`

10. **Reconciler backoff for crash-looping bots**
    - Finding: Error Handling #5
    - Fix: Track per-bot failure count, exponential backoff 30s-300s.
    - Effort: 3 hours
    - Files: `src/daemon.ts`, `src/store.ts`

11. **Add listAllBots catch logging**
    - Finding: Error Handling #9
    - Fix: Add `log.warn()` in catch blocks.
    - Effort: 15 minutes
    - Files: `src/process-manager.ts`

12. **Native runtime unit tests**
    - Finding: Testing #1, #2, #3
    - Fix: Test PID file ops, isProcessAlive (inc. EPERM), buildNativeEnv secret stripping, pickPort, ProcessManager routing.
    - Effort: 8 hours
    - Files: New `test/t21-native.ts`, `test/t22-process-manager.ts`

13. **PID identity verification**
    - Finding: Edge Case #1
    - Fix: Write `pid:startTimeMs` in PID file, verify both before signaling.
    - Effort: 2 hours
    - Files: `src/native.utils.ts`, `src/native.ts`

### Phase 3: Medium-priority improvements (next sprint)

14. **Decompose dashboard-server.ts**
    - Finding: Architecture #4
    - Fix: Extract 5 route modules.
    - Effort: 6 hours
    - Files: `src/dashboard-server.ts` -> `src/routes/{fleet,bots,auth,office,proxy}.ts`

15. **Extract bot-utils from docker.utils**
    - Finding: Architecture #2
    - Fix: Move runtime-agnostic functions to `src/bot-utils.ts`.
    - Effort: 3 hours
    - Files: `src/docker.utils.ts` -> `src/bot-utils.ts`

16. **Unify env builder**
    - Finding: Architecture #7
    - Fix: Extract shared `buildBotEnv()`.
    - Effort: 4 hours
    - Files: `src/docker.utils.ts`, `src/native.utils.ts` -> `src/env-builder.ts`

17. **Shared SSE poll with fan-out**
    - Finding: Edge Case #10
    - Fix: Single poll interval, broadcast to connected clients.
    - Effort: 2 hours
    - Files: `src/dashboard-server.ts` (office stream section)

18. **Add credentials cross-process lock**
    - Finding: Edge Case #16, Architecture #5
    - Fix: Add `withCredentialsLock` using directory lock pattern.
    - Effort: 1 hour
    - Files: `src/auth.ts`

19. **Session cookie Secure flag**
    - Finding: Security #6
    - Fix: Set `Secure` when accessed over HTTPS or configured for remote.
    - Effort: 30 minutes
    - Files: `src/dashboard-server-utils.ts`

20. **Docker tests in CI**
    - Finding: Testing #4
    - Fix: Add CI job with Docker service for `run-docker.ts`.
    - Effort: 2 hours
    - Files: `.github/workflows/ci.yml`

21. **Daemon reconciler tests**
    - Finding: Testing #3
    - Fix: Mock listBots + listAllBots, verify start/stop/skip decisions.
    - Effort: 4 hours
    - Files: New `test/t23-reconciler.ts`

### Phase 4: Low-priority cleanup (when touching these files)

**`src/dashboard-server.ts`:**
- Bound TOTP rate limiter Map (periodic sweep or LRU)
- Bound activeSessions Map (periodic sweep or LRU)
- CORS origin from request or config instead of hardcoded localhost
- WebSocket proxy connection timeout

**`src/process-manager.ts`:**
- Merge `docker.types.ts` into `process-manager.ts`
- Merge `docker.constants.ts` into `constants.ts`

**`src/daemon.ts`:**
- Fix `readState()!` non-null assertion in shutdown handler
- Daemon lock refresh -- detect external removal

**`src/cli-utils.ts`:**
- Deduplicate SSE parser with `mcp-proxy.ts`

**`test/`:**
- Extract shared test harness to `test/helpers.ts`
- Fix T19 replicated function copies (import from source)
- Add code coverage via c8

### Dependency Graph

- Fix 14 (decompose dashboard) depends on Fix 4 (fleet error handling) -- easier to add try/catch before extraction
- Fix 16 (unify env builder) depends on Fix 15 (extract bot-utils) -- shared module location must exist first
- Fix 12 (native tests) should come after Fix 13 (PID identity) -- test the improved behavior
- Fix 20 (Docker CI) is independent of all other fixes

### Estimated Total Effort

- **Phase 1**: 1.5 days (critical security + error handling)
- **Phase 2**: 2.5 days (high-priority hardening + tests)
- **Phase 3**: 3 days (architecture improvements)
- **Phase 4**: 2 days (opportunistic cleanup)
- **Total**: ~9 days
