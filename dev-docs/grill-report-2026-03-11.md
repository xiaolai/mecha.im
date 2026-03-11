---
plugin: grill
version: 1.2.0
date: 2026-03-11
target: /Users/joker/github/xiaolai/myprojects/mecha.im.v3
style: Select All (Architecture Review + Hard-Nosed Critique + Multi-Perspective Panel + ADR Style + Paranoid Mode)
addons: Scale stress, Hidden costs, Principle violations, Strangler fig, Success metrics, Before vs after, Assumptions audit, Compact & optimize
agents: architecture, error-handling, security, testing, edge-cases
---

# Mecha Codebase Grill Report

**Target**: `/Users/joker/github/xiaolai/myprojects/mecha.im.v3`
**Date**: 2026-03-11
**Stack**: TypeScript, Node.js 22+, Hono, Claude Agent SDK, Docker, s6-overlay, Croner, Zod v4
**Size**: ~4,016 LOC across 44 .ts/.tsx files
**Architecture**: Two-process model (Host CLI + Docker container agents)

---

## Style 1: Architecture Review + Rewrite Plan

### 1. Redesign Decisions

The current architecture is clean for a v0.1 project. The two-process model (host CLI managing Docker containers, each running an autonomous Hono HTTP agent) is sound. However, 10 key redesign decisions are needed for production readiness:

**D1. Authentication must be mandatory, not opt-in.** Both `MECHA_DASHBOARD_TOKEN` and `MECHA_BOT_TOKEN` default to unset, leaving all APIs completely open. Every bot container is an unauthenticated code execution endpoint. Auto-generate tokens at spawn time.

**D2. Permission mode default must change from `bypassPermissions` to `default`.** The current default grants autonomous shell execution to any prompt sender -- including unauthenticated webhook payloads and bot-to-bot calls.

**D3. The registry needs cross-process locking.** `store.ts:62-68` performs read-modify-write on `registry.json` with no file-level lock. Concurrent `mecha spawn` commands from different terminals will clobber each other.

**D4. The single-request concurrency model needs a task queue.** Each bot processes exactly one prompt at a time via a Mutex. Scheduled tasks and webhooks are silently dropped when busy. A proper task queue with configurable concurrency would eliminate this bottleneck.

**D5. Structured logging must replace console.log.** A well-designed structured JSON logger exists at `shared/logger.ts` with level filtering and credential redaction -- but no file in the codebase imports it. All 60+ logging calls use raw `console.*`.

**D6. Event log needs rotation.** `event-log.ts` appends indefinitely and reads the entire file into memory. Long-running bots will OOM.

**D7. Process crash handlers are missing.** Neither `agent/entry.ts` nor `src/cli.ts` registers `unhandledRejection` handlers. Unhandled promise rejections crash the process silently.

**D8. Bot-to-bot authentication is absent.** `mecha-call.ts` sends prompts with no auth headers. Any entity on the network can impersonate a bot.

**D9. Container should run as non-root.** The Dockerfile creates `appuser` but never switches to it. The agent runs as root.

**D10. The Dockerfile is x86_64-only.** `Dockerfile:25` hardcodes `s6-overlay-x86_64.tar.xz`.

### 2. New Architecture (Target State)

```
mecha spawn → Docker container:
  ├── s6-overlay (PID 1, runs as root)
  │   ├── tailscaled (drops to nobody)
  │   └── mecha-agent (drops to appuser via s6-setuidgid)
  │       ├── Hono HTTP server (port 3000)
  │       │   ├── Auth middleware (MECHA_BOT_TOKEN required)
  │       │   ├── /prompt (SSE, queued via task queue)
  │       │   ├── /webhook (HMAC required, queued)
  │       │   ├── /api/* (auth required)
  │       │   └── /health (no auth, includes metrics)
  │       ├── Task Queue (configurable concurrency, default 1)
  │       ├── Scheduler (feeds task queue, respects daily limits)
  │       ├── Session Manager (file-based, rotated)
  │       ├── Event Log (rotated, max 10MB per file)
  │       └── Cost Tracker (daily pruning, integer cents)
  │
Fleet Dashboard:
  ├── Auth required (auto-generated token)
  ├── Localhost-only binding by default
  ├── CORS whitelist
  ├── Bot proxy (path whitelist, no redirect following)
  └── Request correlation IDs
```

### 3. Data Model Changes

- **Cost tracking**: Switch from floating-point USD to integer cents to avoid accumulation drift
- **Event log**: Add rotation (max 10MB, keep last 5 files)
- **Registry**: Add file-level locking via `flock` or lockfile
- **Session index**: Add archive mechanism before pruning (currently data is permanently lost)

### 4. Reliability Plan

- Add `unhandledRejection`/`uncaughtException` handlers to both processes
- Add graceful shutdown timeout (5s) before SIGKILL
- Replace `.catch(() => {})` in restart endpoint with selective error matching
- Add retry logic (1 retry, 2s delay) for bot-to-bot calls
- Add health metrics to `/health` endpoint (request count, error count, cost rate)
- Add orphan container detection command (`mecha reconcile`)

### 5. Security Plan

- Auto-generate `MECHA_BOT_TOKEN` per bot at spawn time
- Require `MECHA_DASHBOARD_TOKEN` (auto-generate if not set)
- Change default `permission_mode` to `"default"`
- Require `webhooks.secret` when webhooks are configured
- Run container as `appuser` (non-root)
- Read API keys from stdin or file, not CLI args
- Apply `chmod 0600` to `mecha.json`
- Use `TS_AUTHKEY` env var instead of `--auth-key` flag
- Add CORS middleware to both servers
- Bind dashboard to `127.0.0.1` by default
- Use `realpathSync()` for `config_path` validation
- Add `redirect: "manual"` to proxy fetch

### 6. Testing Plan

- Install vitest (30 min)
- Unit tests for shared/ (validation, errors, mutex, safe-read, atomic-write) -- 4h
- Unit tests for agent/ business logic (costs, session, scheduler, webhook) -- 6h
- Unit tests for src/ (config, auth, docker with mocked dockerode) -- 5h
- GitHub Actions CI (type check + unit tests + build) -- 2h
- Target: 80% line coverage for shared/ and agent/ within 2 weeks

### 7. Performance Plan

- Event log: tail-read instead of full-file read
- Dashboard `/api/network`: cache bot IPs with 10s TTL
- Batch scheduler state saves (debounce)
- Cost tracking: integer arithmetic (no float drift)

### 8. DX Improvements

- Install Biome for lint + format (1h)
- Add `npm run test:unit`, `test:watch`, `test:coverage` scripts
- Add multi-arch Docker build support
- Add `mecha reconcile` for orphan cleanup
- Read API keys interactively instead of CLI args

### 9. Incremental Migration Path

1. **Week 1 (Critical Security)**: Auth enforcement, permission mode default, unhandled rejection handlers, non-root container
2. **Week 2 (Reliability)**: Registry locking, graceful shutdown, event log rotation, structured logging adoption
3. **Week 3 (Testing)**: Vitest setup, shared/ unit tests, CI pipeline
4. **Week 4 (Hardening)**: Bot-to-bot auth, webhook secret requirement, CORS, rate limiting

### 10. What to Keep

- **Module boundary design**: Clean separation between src/, agent/, shared/ with minimal cross-imports
- **Error hierarchy**: `defError` factory with HTTP status codes and CLI exit codes
- **Atomic file writes**: Correct write-temp-fsync-rename pattern
- **Mutex with eviction**: Well-implemented, prevents memory leaks
- **Scheduler safety limits**: Daily caps, auto-pause on consecutive errors
- **Webhook HMAC verification**: Correct `timingSafeEqual` usage
- **Config validation**: Comprehensive Zod schemas with good defaults

---

## Style 2: Hard-Nosed Critique + Roadmap

### Critical Flaws (with specific examples)

**Flaw 1: The entire system runs without authentication by default.**
Every bot container has an unauthenticated `/prompt` endpoint that executes arbitrary code with `bypassPermissions`. The dashboard proxy forwards unauthenticated requests to every bot. This is not "missing a feature" -- it's a live exploit path.
- Evidence: `server.ts:23` returns null (skip auth) when no token set; `dashboard-server.ts:51` skips auth check when no token set; `docker.ts:99-102` never sets `MECHA_BOT_TOKEN` in container env.

**Flaw 2: The structured logger was written and then never integrated.**
60+ `console.*` calls across the codebase. The logger at `shared/logger.ts` has redaction, levels, structured JSON output -- and zero imports. API keys could be logged in plaintext by any accidental `console.log(config)`.

**Flaw 3: Zero unit tests for ~4,000 lines of code.**
One 172-line integration test that requires Docker. No unit test framework installed. Every change is deployed on faith.

**Flaw 4: Silent errors hide real problems.**
- `dashboard-server.ts:140`: `.catch(() => {})` on restart stop
- `auth.ts:88`: bare `catch {}` swallows permission errors during auth resolution
- `event-log.ts:56-58`: returns `[]` for any read error (disk full looks like "no events")
- `cli.ts:38-41`: headscale pull failure logs misleading "Pulling..." message

### 80/20 Rewrite Plan

Don't rewrite. Fix the 20% that causes 80% of risk:
1. **Enforce auth everywhere** (3h) -- auto-generate tokens, require them
2. **Adopt the structured logger** (2h) -- find-replace console.* calls
3. **Add vitest + 10 critical unit tests** (4h) -- validation, mutex, costs, webhook HMAC
4. **Add CI pipeline** (2h) -- type check, unit tests, build
5. **Fix silent error paths** (1h) -- selective catches instead of bare catch

### Prioritized 15-Item Backlog

| # | Item | Impact | Risk | Effort | Priority |
|---|------|--------|------|--------|----------|
| 1 | Auto-generate bot tokens at spawn | Critical | Security | 3h | P0 |
| 2 | Change default permission_mode to "default" | Critical | Security | 30m | P0 |
| 3 | Add unhandledRejection handlers | High | Reliability | 15m | P0 |
| 4 | Fix .catch(() => {}) in restart | High | Reliability | 15m | P0 |
| 5 | Replace console.* with structured logger | High | Observability | 2h | P1 |
| 6 | Install vitest + unit tests for shared/ | High | Quality | 4h | P1 |
| 7 | GitHub Actions CI pipeline | High | Quality | 2h | P1 |
| 8 | Registry cross-process file locking | High | Reliability | 6h | P1 |
| 9 | Event log rotation | High | Reliability | 3h | P1 |
| 10 | Run container as non-root | Medium | Security | 1h | P2 |
| 11 | Bot-to-bot auth (shared fleet token) | Medium | Security | 6h | P2 |
| 12 | Require webhook secret when configured | Medium | Security | 1h | P2 |
| 13 | Graceful shutdown timeout | Medium | Reliability | 1h | P2 |
| 14 | Request correlation IDs | Medium | Observability | 4h | P2 |
| 15 | Multi-arch Dockerfile | Medium | DX | 2h | P3 |

### Red Flags

- **Financial exposure**: No cost ceiling at the HTTP layer. Rate-limited only by mutex (1 at a time), but sustained abuse = sustained billing.
- **No audit trail**: If auth profiles are leaked, there's no way to know who used them or when.
- **Orphan containers**: Host crash between `container.start()` and `setBot()` leaves running containers invisible to the CLI.

### Quick Wins

**Under 1 day:**
- Add `unhandledRejection` handlers (15 min)
- Fix `.catch(() => {})` in restart (15 min)
- Change permission_mode default (30 min)
- Apply `chmod 0600` to `mecha.json` (10 min)
- Use `parsePort()` in `agent/entry.ts` (5 min)
- Bind dashboard to `127.0.0.1` (5 min)
- Add `redirect: "manual"` to proxy fetch (5 min)

**Under 1 week:**
- Auth enforcement (auto-generate tokens) (3h)
- Adopt structured logger across codebase (2h)
- Vitest setup + shared/ unit tests (4h)
- CI pipeline (2h)
- Event log rotation (3h)
- Non-root container (1h)

---

## Style 3: Multi-Perspective Panel

### Staff Backend Engineer

**Top 3 Changes:**

1. **Registry needs file-level locking** (`store.ts:62-68`). The per-bot in-process mutex doesn't protect cross-process writes. Two concurrent `mecha spawn` calls corrupt the registry. Risk: data loss. Fix: advisory file lock via `flock()`.

2. **Single-request concurrency is an architectural ceiling** (`server.ts:159`). Every webhook, every scheduled task, every bot-to-bot call queues behind the current conversation. A 5-minute Claude query blocks everything. Fix: task queue with configurable concurrency.

3. **Adopt the structured logger** (`shared/logger.ts`). 60+ `console.*` calls with no structured output, no level filtering, no credential redaction in practice. In production with multiple containers, logs will be unreadable. Fix: 2-hour migration.

### Security Engineer

**Top 3 Changes:**

1. **Enforce authentication everywhere** (`server.ts:23`, `dashboard-server.ts:51`). The default-open pattern is unacceptable for a system that executes arbitrary code. Auto-generate tokens at spawn time. This is the single highest-risk finding.

2. **Change permission_mode default to "default"** (`types.ts:12`). Combined with no auth, every bot is an arbitrary code execution endpoint. The SDK's `bypassPermissions` should require explicit opt-in.

3. **Read API keys from stdin, not CLI args** (`cli.ts:376`). `mecha auth add <profile> <key>` puts the key in shell history and `ps` output.

### SRE / Platform Engineer

**Top 3 Changes:**

1. **Add `unhandledRejection` handlers to both processes** (`entry.ts`, `cli.ts`). Without these, promise rejections crash the process with no structured log. The container restarts but you don't know why.

2. **Add graceful shutdown timeout** (`entry.ts:73-83`). `server.close()` waits for all connections. A 5-minute SSE stream delays shutdown past Docker's SIGKILL timeout, losing in-flight state.

3. **Add orphan container reconciliation** (`docker.ts:149-197`). If the host crashes between `container.start()` and `setBot()`, the container runs invisibly. Add a `mecha reconcile` command that compares Docker labels with the registry.

### Performance Engineer

**Top 3 Changes:**

1. **Event log reads the entire file** (`event-log.ts:43`). `readFileSync` on an unbounded JSONL file for every `/api/logs` call. Implement tail-reading or rotation.

2. **Dashboard polls all bot IPs on every /api/network request** (`dashboard-server.ts:169-192`). With 10+ bots, this creates O(n) Docker inspect calls + HTTP fetches per request. Cache with 10s TTL.

3. **Floating-point cost accumulation** (`costs.ts:38-43`). Thousands of small additions cause IEEE 754 drift. Use integer cents.

### Product Engineer

**Top 3 Changes:**

1. **The dashboard is API-only when not built** (`dashboard-server.ts:242-248`). If `dashboard/dist` doesn't exist, the user gets a raw JSON response. The build step is manual and not documented in the README.

2. **No daily cost ceiling** (`server.ts`). The `max_budget_usd` is per-session, but there's no aggregate daily limit. A runaway scheduler or attacker can burn unlimited credits per day.

3. **Webhook events are silently dropped when busy** (`scheduler.ts:141`). If the bot is processing a prompt when a critical webhook fires, the event is logged and discarded. The user has no notification that events were missed.

### Junior Developer Advocate

**Top 3 Changes:**

1. **No unit tests means no documentation of behavior** (entire codebase). There's no way for a new contributor to understand the expected behavior of `Mutex.evict()`, `Scheduler.fire()`, or `CostTracker.prune()` without reading the implementation. Tests are executable documentation.

2. **No linter or formatter** (codebase-wide). A new contributor has no guardrails. Install Biome for combined lint+format.

3. **The integration test requires Docker** (`test/integration.test.ts`). A new contributor can't run any tests without Docker set up and an API key available. Unit tests would provide a faster feedback loop.

### Unified Plan

The panel agrees unanimously on three actions:
1. **Enforce authentication** (security + SRE + product all flag this as #1)
2. **Adopt structured logging** (backend + SRE + junior dev all flag this)
3. **Add unit tests** (backend + junior dev + product all flag this)

Disagreement: The security engineer wants to change `permission_mode` default immediately, but the product engineer notes this would break existing bots that rely on autonomous execution. Resolution: change the default but add a migration guide, and print a deprecation warning for configs that don't explicitly set `permission_mode`.

---

## Style 4: ADR Style

### ADR-001: Enforce Authentication by Default

**Context**: Both dashboard and bot APIs run without authentication when tokens are not set. Every bot container is an unauthenticated code execution endpoint.

**Decision**: Auto-generate a random 32-byte hex token per bot at spawn time. Pass it as `MECHA_BOT_TOKEN`. Auto-generate `MECHA_DASHBOARD_TOKEN` when `mecha dashboard` starts if not set. Print token to stdout.

**Alternatives**:
- Mutual TLS between bots (too complex for v1)
- Require user to manually set tokens (error-prone, current state)
- OAuth2 / JWT (overengineered for single-user CLI tool)

**Consequences**: Breaking change for existing deployments (must update any external integrations to include Bearer token). Bot-to-bot calls need a shared fleet token mechanism.

**Migration**: Existing bots without tokens continue to work but print a deprecation warning. v2 makes tokens mandatory.

### ADR-002: Change Default Permission Mode

**Context**: `permission_mode` defaults to `bypassPermissions`, granting autonomous shell execution to any prompt sender.

**Decision**: Change default to `"default"`. Require explicit opt-in for `bypassPermissions` in bot config.

**Alternatives**:
- Keep `bypassPermissions` default with auth requirement (still risky if auth is misconfigured)
- Use `"acceptEdits"` as middle ground

**Consequences**: Existing bots relying on autonomous execution will need to add `permission_mode: bypassPermissions` to their config. Print migration warning.

### ADR-003: Adopt Structured Logging

**Context**: `shared/logger.ts` exists with level filtering and credential redaction but is never imported. All logging uses raw `console.*`.

**Decision**: Replace all `console.*` calls with `log.*` from `shared/logger.ts`. Set default level to `info` in production, `debug` in development.

**Alternatives**:
- Use pino (heavier dependency, more features)
- Keep console.log (no redaction, no levels)

**Consequences**: Log output changes from text to JSON. Existing log parsing scripts (if any) will break. Container logs become machine-parseable.

### ADR-004: Add Cross-Process Registry Locking

**Context**: `store.ts` read-modify-write on `registry.json` has no file-level lock. Concurrent CLI commands corrupt the registry.

**Decision**: Use advisory file locking (`flock` via `proper-lockfile` or `fs.flock`) around all registry read-modify-write operations.

**Alternatives**:
- SQLite for registry (adds dependency, overkill for key-value)
- Append-only log with compaction (complex)
- Retry on conflict (doesn't prevent corruption)

**Consequences**: Adds ~100ms latency to registry operations. Windows compatibility requires attention (flock behavior differs).

### ADR-005: Implement Event Log Rotation

**Context**: `events.jsonl` grows without bound. `readEvents()` reads the entire file into memory.

**Decision**: Rotate at 10MB. Keep last 5 files. Read only the current file for API responses. Implement tail-reading for `/api/logs`.

**Alternatives**:
- SQLite for events (adds dependency)
- External log aggregation (assumes infrastructure)
- Time-based rotation (harder to predict size)

**Consequences**: Historical events older than ~50MB are lost. If audit trail is needed, add an external log sink.

### ADR-006: Add Unit Test Infrastructure

**Context**: Zero unit tests across 4,016 LOC. Single integration test requires Docker.

**Decision**: Install vitest. Target 80% coverage for shared/ and agent/ business logic. Add `test:unit`, `test:coverage` npm scripts. Add GitHub Actions CI.

**Alternatives**:
- node:test built-in (fewer features, no coverage)
- jest (ESM support is painful)
- mocha (needs separate assertion/coverage libraries)

**Consequences**: ~4h initial setup. 15-20h to reach 80% coverage. CI adds ~2min to each push.

### ADR-007: Non-Root Container Execution

**Context**: The Dockerfile creates `appuser` but the agent runs as root. Combined with `bypassPermissions`, this maximizes blast radius.

**Decision**: Use `s6-setuidgid appuser` in the mecha-agent service run script. Ensure `/state`, `/app`, and `/home/appuser` are owned by `appuser` in the Dockerfile.

**Alternatives**:
- `USER appuser` in Dockerfile (blocks s6-overlay which needs root for init)
- rootless Docker (requires host configuration)

**Consequences**: Any file operations in `/state` will run as `appuser`. Existing bot data directories may need ownership fix.

### ADR-008: Task Queue for Prompt Processing

**Context**: Single Mutex limits each bot to one prompt at a time. Scheduled tasks and webhooks are silently dropped when busy.

**Decision**: Replace Mutex with a bounded task queue (default capacity 1, configurable). Scheduled tasks and webhooks queue instead of being dropped. Add queue status to `/health`.

**Alternatives**:
- Keep single Mutex (simple, but drops events)
- External queue (Redis/RabbitMQ -- too heavy)
- Concurrent execution (risky with shared state)

**Consequences**: Queued webhooks may be processed minutes after receipt. Need queue size limits and timeout handling. Claude API costs increase if queue processes more.

---

## Style 5: Paranoid Mode (Edge Case Gauntlet)

### Edge Case Risk Matrix

| # | Scenario | L | I | Risk | Component | File |
|---|----------|---|---|------|-----------|------|
| 1 | Default-open APIs allow unauthenticated code execution | 5 | 5 | **25** | dashboard-server, agent/server | `dashboard-server.ts:51`, `server.ts:23` |
| 2 | Registry corruption from concurrent bot spawns | 3 | 5 | **15** | store | `store.ts:62-68` |
| 3 | TOCTOU busy check allows double prompt execution + double billing | 3 | 4 | **12** | agent/server | `server.ts:159-166` |
| 4 | Headscale API key leaked to all bot containers (fleet-wide compromise) | 3 | 4 | **12** | docker | `docker.ts:121-124` |
| 5 | Webhook body size limit bypassed without HMAC secret (OOM) | 3 | 4 | **12** | webhook | `webhook.ts:65` |
| 6 | Event log grows unbounded, OOM on read | 4 | 3 | **12** | event-log | `event-log.ts:43` |
| 7 | Mutex map eviction destroys active lock references | 1 | 5 | **5** | mutex | `mutex.ts:42-50` |
| 8 | No graceful shutdown timeout, SIGKILL during mid-write | 4 | 3 | **12** | entry | `entry.ts:73-83` |
| 9 | Container leak on registry write failure (orphaned, billing) | 2 | 3 | **6** | docker | `docker.ts:190-199` |
| 10 | Scheduler + prompt race on busy check | 3 | 3 | **9** | scheduler/server | `scheduler.ts:137-148` |
| 11 | Docker build uses cwd() as context (wrong directory = stale image) | 3 | 3 | **9** | docker | `docker.ts:26` |
| 12 | Auth swap concurrent registry corruption | 2 | 3 | **6** | cli/store | `cli.ts:398-424` |
| 13 | Tailscale auth key in cmdline visible in /proc | 2 | 3 | **6** | s6 | `s6/tailscale-up/up:25` |
| 14 | Scheduler nextRunAt index correlation mismatch | 3 | 1 | **3** | scheduler | `scheduler.ts:169-172` |
| 15 | Floating-point cost accumulation drift | 4 | 1 | **4** | costs | `costs.ts:38-43` |

**L** = Likelihood (1-5), **I** = Impact (1-5), **Risk** = L x I

### Cascading Failure Chains

**Chain 1: Unauthenticated Fleet Takeover**
```
Attacker discovers dashboard port → No auth (Finding 1)
→ POST /api/bots to spawn dozens of bots → Registry corruption (Finding 2)
→ Orphaned containers with RestartPolicy:unless-stopped → Cost burn
→ Each bot runs bypassPermissions → Arbitrary code execution
→ Read MECHA_HEADSCALE_API_KEY from env → Fleet-wide compromise
```

**Chain 2: Long Query + Shutdown = State Loss**
```
Bot receives complex prompt → 5-minute Claude query
→ SIGTERM received → server.close() waits for SSE connection
→ Docker SIGKILL after 10s → Mid-write to costs.json
→ Atomic write interrupted between rename and fsync
→ Corrupt cost data on next boot
```

**Chain 3: Webhook Abuse**
```
Bot configured without webhook secret → Finding 5 applies
→ Attacker sends oversized JSON body → No size limit without secret
→ Container OOM → Docker restarts container
→ On restart, pending scheduler fires immediately → Double execution
→ Scheduler busy check race → Double billing
```

### Paranoid Verdict

**The single scariest thing**: An attacker discovers any exposed dashboard port running without `MECHA_DASHBOARD_TOKEN`. They can spawn dozens of bots in parallel, corrupting the registry (no cross-process locking). Each spawned bot runs with `bypassPermissions` and no `MECHA_BOT_TOKEN`. The orphaned containers (not properly registered due to race conditions) burn API credits via their schedulers indefinitely, with no CLI-level way to stop them. The Headscale API key passed to every container allows the attacker to compromise the mesh network. **Total blast radius: uncontrolled cost burn + fleet-wide autonomous code execution + mesh network compromise.**

---

## Add-on: Scale Stress

> "Assume traffic grows 100x and team doubles -- what breaks first?"

1. **Registry.json breaks first.** File-based read-modify-write with no locking cannot handle concurrent CLI usage from multiple team members. At 100 bots, parallel operations are guaranteed.

2. **Event log OOM.** 100 bots each running for months generates GB-sized JSONL files. The `readEvents()` full-file read becomes a showstopper.

3. **Dashboard /api/network becomes unusable.** Polling all 100 bot IPs serially with 3-second timeouts = up to 300 seconds per request.

4. **Docker label query slows down.** `docker.listContainers` with label filter at 100+ containers adds latency to every `mecha ls`.

5. **Cost tracking drift compounds.** 100 bots with floating-point cost accumulation drift = meaningful reporting inaccuracies.

## Add-on: Hidden Costs

1. **Debugging cost**: No structured logging, no request correlation IDs, no tracing. Cross-bot debugging requires manually correlating timestamps across multiple `docker logs` streams. Estimated: 2-4 hours per production incident.

2. **Onboarding cost**: Zero unit tests means no executable documentation. New contributor must read all 4,016 LOC to understand behavior. No linter/formatter means reviewing PRs is manual style checking. Estimated: 1 week per new contributor.

3. **Operational cost**: No orphan detection means periodic manual `docker ps | grep mecha-` audits. No cost ceiling means manual monitoring for runaway billing. Estimated: 30 min/day operational overhead.

4. **Velocity cost**: Single integration test requiring Docker means 60+ second feedback loops. No CI means bugs reach production without automated checks. Estimated: 20% velocity tax.

5. **Security cost**: Default-open authentication means constant vigilance about network exposure. No CORS means assuming every browser tab is trusted. Estimated: unquantifiable until breached.

## Add-on: Principle Violations

1. **Least Privilege violated**: Default `bypassPermissions` + root container + no auth = maximum privilege everywhere. Both the permission model and the container user should follow least privilege.

2. **Single Responsibility violated**: `dashboard-server.ts` (256 lines) handles auth middleware, CRUD routes, reverse proxy, static serving, and schema definitions. `server.ts` mixes route handling, SDK invocation, and SSE streaming.

3. **Dependency Inversion violated**: `mecha-call.ts` directly constructs URLs and calls `fetch`. No abstraction layer for bot-to-bot communication. Adding a different transport (e.g., message queue) requires rewriting the tool.

4. **Fail-Fast violated**: `auth.ts:88` catch-all silently falls through on permission errors. `event-log.ts:56` returns `[]` on any read error. `dashboard-server.ts:140` `.catch(() => {})` swallows all stop errors.

5. **Defense in Depth violated**: Auth is the single layer of defense, and it's opt-in. No rate limiting, no cost ceiling, no input sanitization beyond Zod schemas, no CORS, no CSP.

## Add-on: Strangler Fig

No big-bang rewrite needed. The codebase is small (4K LOC) and well-structured. Apply fixes incrementally:

**Phase 1 (Strangle the security gaps):**
- Add auth enforcement as middleware (doesn't change route handlers)
- Change permission_mode default (one-line change + deprecation warning)
- Add unhandled rejection handlers (additive, no existing code changes)

**Phase 2 (Strangle the state layer):**
- Add file locking around registry operations (wraps existing read/write)
- Add event log rotation (wraps existing append)
- Adopt structured logger (find-replace console.* calls)

**Phase 3 (Strangle the concurrency model):**
- Replace Mutex with task queue (same interface, different implementation)
- Queue webhooks and scheduled tasks instead of dropping them

## Add-on: Success Metrics

| Metric | Current | Target | How to Measure |
|--------|---------|--------|----------------|
| Unit test coverage | 0% | 80% (shared/ + agent/) | `vitest --coverage` |
| Mean time to detect (MTTD) | Unknown (no structured logs) | < 5 min | Structured log alerts on error rate |
| Mean time to recover (MTTR) | Manual Docker cleanup | < 10 min | Orphan reconciliation + auto-restart |
| p95 `/api/logs` latency | Unbounded (full file read) | < 100ms | Event log rotation + tail read |
| Security: Unauthenticated endpoints | 100% | 0% | Auth middleware on all routes |
| CI pipeline time | N/A | < 3 min | GitHub Actions |
| Defect escape rate | Unknown | < 1 per release | CI + unit tests + type checking |

## Add-on: Before vs After

### Before (Current State)
```
CLI (mecha spawn) ──> Docker API ──> Container
                                       │
     ┌─────────────────────────────────┘
     │
     v
  Hono Server (NO AUTH, port 3000, root user)
     ├── /prompt ──> Mutex (1 at a time) ──> Claude SDK (bypassPermissions)
     ├── /webhook ──> No secret required ──> Same Mutex
     ├── /api/* ──> No auth
     └── Scheduler ──> Drops when busy

  Fleet Dashboard (NO AUTH, port 7700, all interfaces, HTTP)
     ├── /api/bots ──> registry.json (NO FILE LOCK)
     ├── /bot/:name/* ──> Proxy (follows redirects)
     └── /api/network ──> Polls all bots serially

  Logging: console.log() everywhere
  Tests: 1 integration test (Docker required)
  CI: None
```

### After (Target State)
```
CLI (mecha spawn) ──> Docker API ──> Container
     │                                  │
     │  Auto-generated bot token ───────┘
     v
  Hono Server (AUTH REQUIRED, port 3000, appuser)
     ├── /prompt ──> Task Queue (configurable) ──> Claude SDK (default mode)
     ├── /webhook ──> HMAC required ──> Task Queue
     ├── /api/* ──> Bearer token required
     └── Scheduler ──> Queues when busy

  Fleet Dashboard (AUTH REQUIRED, localhost:7700, CORS whitelist)
     ├── /api/bots ──> registry.json (FILE LOCKED)
     ├── /bot/:name/* ──> Proxy (path whitelist, no redirects)
     └── /api/network ──> Cached bot IPs (10s TTL)

  Logging: Structured JSON logger with redaction
  Tests: vitest + 80% unit coverage + integration
  CI: GitHub Actions (typecheck + test + build)
```

## Add-on: Assumptions Audit

| Assumption | Evidence | Validation Plan |
|-----------|----------|-----------------|
| Docker daemon is always available | `docker.ts` has no daemon-down fallback | Add health check command that verifies Docker is running |
| Only one CLI process runs at a time | `store.ts:63` comment says "safe under single-CLI usage" | Add file locking (already recommended) |
| Container networking allows IP-based communication | `docker.ts:153` gets container IP | Test with custom Docker networks and network policies |
| Tailscale DNS resolves `mecha-<name>` | `mecha-call.ts:8` constructs URL by convention | Add retry + fallback to Headscale API lookup |
| `/state` directory is always writable | No check at startup | Add startup validation in `entry.ts` |
| Clock is monotonic (no NTP jumps) | Scheduler uses Date.now() for daily limits | Use `process.hrtime` for duration measurements |
| YAML configs are trusted | `loadBotConfig` parses YAML from user-specified path | Already validated by Zod schema (good) |
| Node.js 22 is available | `package.json` engines not set | Add `engines: { node: ">=22" }` to package.json |

## Add-on: Compact & Optimize

1. **SSE parser duplication**: `src/cli.ts:328-354` and `agent/tools/mecha-call.ts:51-93` both parse SSE streams. Extract to `shared/sse-parser.ts`. Saves ~40 lines.

2. **Auth middleware duplication**: `agent/server.ts` has 12 occurrences of `const denied = requireAuth(c)`. Convert to Hono middleware (like dashboard already does). Saves ~24 lines.

3. **`safeError` pattern duplication**: Both `dashboard-server.ts:38-44` and CLI error handling at `cli.ts:461-471` convert MechaError to output. Could share a helper.

4. **Unused logger**: Either adopt `shared/logger.ts` everywhere or delete it. Dead code is worse than no code.

5. **`defError` factory**: 12 error classes defined individually could use a registry pattern, but current approach is clear enough. No action needed.

6. **Dashboard server**: Could split into `routes/bots.ts`, `routes/auth.ts`, `routes/proxy.ts` at ~256 lines, but not urgent.

---

## Executive Summary

### One-Paragraph Verdict

Mecha has a **clean, well-structured architecture for a v0.1 project** -- module boundaries are respected, the error hierarchy is thoughtful, and atomic file writes show attention to correctness. However, the codebase has **critical security gaps that make it unsuitable for any networked deployment**: every API endpoint runs without authentication by default, the default permission mode grants autonomous code execution, and there are zero unit tests to catch regressions. The biggest risk is not a bug -- it's the **design decision to make security opt-in rather than opt-out**, combined with the inherent danger of autonomous agents that can execute arbitrary shell commands.

### Top 3 Actions

1. **Enforce authentication everywhere** (3h). Auto-generate `MECHA_BOT_TOKEN` per container, require `MECHA_DASHBOARD_TOKEN`, add bot-to-bot fleet token. This single change closes the most critical attack surface.

2. **Change `permission_mode` default from `bypassPermissions` to `default`** (30 min + migration docs). The current default means any authenticated (or unauthenticated!) prompt triggers autonomous code execution. This must be opt-in.

3. **Add unit tests + CI** (6h). Install vitest, write tests for shared/ utilities and security-critical paths (HMAC verification, auth resolution, cost tracking), add GitHub Actions pipeline. This provides the safety net for all other changes.

### Confidence Levels

| Recommendation | Confidence | What Would Increase Confidence |
|---------------|------------|-------------------------------|
| Auth enforcement | **High** | Penetration testing of the deployed system |
| Permission mode change | **High** | User feedback on breaking change impact |
| Unit tests + CI | **High** | Coverage report showing actual risk areas |
| Registry file locking | **Medium** | Load testing with concurrent CLI operations |
| Task queue (replace Mutex) | **Medium** | Profiling real-world webhook/scheduler patterns |
| Event log rotation | **High** | Measuring actual log growth rates in production |
| Structured logging adoption | **High** | None needed -- the logger already exists and works |
| Non-root container | **High** | Testing that s6-overlay still functions correctly |

### Paranoid Verdict

**The single scariest thing**: An attacker discovers an exposed dashboard port (no auth by default, binds to all interfaces). They spawn dozens of bots concurrently, corrupting the registry via race conditions. Each orphaned bot runs `bypassPermissions` with root inside the container, reads `MECHA_HEADSCALE_API_KEY` from its own environment, and compromises the entire mesh network. The orphaned containers are invisible to the CLI, have `RestartPolicy: unless-stopped`, and burn API credits indefinitely via their schedulers. **Blast radius: uncontrolled cost burn + fleet-wide autonomous code execution + mesh network compromise.** Fix: enforce auth + change permission default + add registry locking. Total effort: ~10 hours.

---

## Fixing Plan

### Phase 1: Critical fixes (do immediately)

**1.1 Auto-generate MECHA_BOT_TOKEN per container**
- **Finding**: Security #1, Edge #6 -- Default-open APIs allow unauthenticated code execution
- **Fix**: In `docker.ts:spawn()`, generate a random 32-byte hex token via `crypto.randomBytes(32).toString("hex")`. Add it to the container env array. Store it in the bot registry entry. Use it for bot-to-bot calls.
- **Effort**: 3 hours
- **Files to modify**: `src/docker.ts`, `src/store.ts`, `agent/tools/mecha-call.ts`

**1.2 Require MECHA_DASHBOARD_TOKEN**
- **Finding**: Security #1 -- Dashboard auth bypass
- **Fix**: Auto-generate token if not set. Print to stdout. Reject all requests without it.
- **Effort**: 1 hour
- **Files to modify**: `src/dashboard-server.ts`, `src/cli.ts`

**1.3 Change default permission_mode to "default"**
- **Finding**: Security #2 -- bypassPermissions grants autonomous code execution
- **Fix**: Change `z.enum([...]).default("bypassPermissions")` to `.default("default")` in `agent/types.ts:12`. Print deprecation warning for configs without explicit permission_mode.
- **Effort**: 30 minutes
- **Files to modify**: `agent/types.ts`, `agent/entry.ts` (warning)

**1.4 Add unhandledRejection handlers**
- **Finding**: Error #1.2, #1.3 -- Silent process crashes
- **Fix**: Add `process.on("unhandledRejection", ...)` and `process.on("uncaughtException", ...)` to both `agent/entry.ts` and `src/cli.ts`.
- **Effort**: 15 minutes
- **Files to modify**: `agent/entry.ts`, `src/cli.ts`

**1.5 Fix silent .catch(() => {}) in restart**
- **Finding**: Error #2.1 -- Restart stop swallows all Docker errors
- **Fix**: Replace `.catch(() => {})` with selective catch matching `isDockerError(err, "is not running")` pattern.
- **Effort**: 15 minutes
- **Files to modify**: `src/dashboard-server.ts:140`

**1.6 Fix auth catch-all swallowing errors**
- **Finding**: Error #2.2 -- resolveAuth bare catch swallows permission errors
- **Fix**: Catch only `AuthProfileNotFoundError` specifically.
- **Effort**: 10 minutes
- **Files to modify**: `src/auth.ts:88`

### Phase 2: High-priority fixes (this sprint)

**2.1 Adopt structured logger across codebase**
- **Finding**: Error #3.1, Architecture A10 -- Logger exists but is never imported
- **Fix**: Replace ~60 `console.*` calls with `log.*` from `shared/logger.ts`. Priority: `agent/entry.ts`, `agent/scheduler.ts`, `agent/server.ts`, `src/docker.ts`, `src/dashboard-server.ts`.
- **Effort**: 2 hours
- **Files to modify**: All .ts files with `console.*` calls

**2.2 Install vitest + unit tests for shared/**
- **Finding**: Testing -- Zero unit tests for 4,016 LOC
- **Fix**: `npm install -D vitest`. Add test scripts. Write tests for `shared/validation.ts`, `shared/errors.ts`, `shared/mutex.ts`, `shared/safe-read.ts`, `shared/atomic-write.ts`.
- **Effort**: 4 hours
- **Files to modify**: `package.json`, new `test/unit/` directory

**2.3 Add GitHub Actions CI**
- **Finding**: Testing -- No CI/CD pipeline
- **Fix**: Create `.github/workflows/ci.yml` with type check, unit tests, build stages.
- **Effort**: 2 hours
- **Files to modify**: New `.github/workflows/ci.yml`

**2.4 Add cross-process registry locking**
- **Finding**: Architecture A1, Edge #2 -- Registry corruption from concurrent operations
- **Fix**: Use `proper-lockfile` or advisory `flock()` around read-modify-write in `store.ts`.
- **Effort**: 6 hours
- **Files to modify**: `src/store.ts`, `package.json`

**2.5 Add event log rotation**
- **Finding**: Architecture A6, Edge #5 -- Unbounded growth, OOM on read
- **Fix**: Rotate at 10MB, keep last 5 files. Implement tail-reading for `/api/logs`.
- **Effort**: 3 hours
- **Files to modify**: `agent/event-log.ts`

**2.6 Require webhook secret when webhooks are configured**
- **Finding**: Security #5, Edge #7 -- Unsigned payloads accepted by default
- **Fix**: Validate that `webhooks.secret` is set in `botConfigSchema` when `webhooks` is present (Zod refine). Or reject unsigned requests at runtime.
- **Effort**: 1 hour
- **Files to modify**: `agent/types.ts`, `agent/webhook.ts`

**2.7 Run container as non-root**
- **Finding**: Security #8 -- Agent runs as root in container
- **Fix**: Add `s6-setuidgid appuser` to `s6/mecha-agent/run`. Ensure `/state` and `/app` owned by appuser in Dockerfile.
- **Effort**: 1 hour
- **Files to modify**: `Dockerfile`, `s6/mecha-agent/run`

### Phase 3: Medium-priority improvements (next sprint)

**3.1 Add request correlation IDs**
- **Finding**: Error #3.2 -- No cross-bot tracing
- **Fix**: Generate UUID in Hono middleware, thread through handlers, include in logEvent calls.
- **Effort**: 4 hours
- **Files to modify**: `agent/server.ts`, `agent/event-log.ts`, `agent/session.ts`

**3.2 Bot-to-bot authentication**
- **Finding**: Architecture A7, Security #6 -- No auth on mecha_call
- **Fix**: Generate fleet-wide shared secret at init. Distribute to all bots via env var. Include as Bearer token in mecha-call requests.
- **Effort**: 6 hours
- **Files to modify**: `src/docker.ts`, `agent/tools/mecha-call.ts`, `agent/server.ts`

**3.3 Graceful shutdown timeout**
- **Finding**: Edge #15 -- server.close() hangs, SIGKILL during writes
- **Fix**: Add 5-second timeout after server.close(). Force-close remaining connections. Ensure atomic writes complete.
- **Effort**: 1 hour
- **Files to modify**: `agent/entry.ts`

**3.4 Dashboard bind to localhost**
- **Finding**: Security #13 -- HTTP on all interfaces
- **Fix**: Add `hostname: "127.0.0.1"` to serve options. Add `--host` flag for explicit override.
- **Effort**: 30 minutes
- **Files to modify**: `src/dashboard-server.ts`, `src/cli.ts`

**3.5 CORS middleware**
- **Finding**: Security #14 -- No CORS on either server
- **Fix**: Add Hono CORS middleware with restrictive origin whitelist.
- **Effort**: 30 minutes
- **Files to modify**: `src/dashboard-server.ts`, `agent/server.ts`

**3.6 Read API keys from stdin, not CLI args**
- **Finding**: Security #3 -- API key in shell history
- **Fix**: Accept `--key-file <path>` or read from stdin when key arg is `-`.
- **Effort**: 1 hour
- **Files to modify**: `src/cli.ts`

**3.7 Use parsePort() in agent/entry.ts**
- **Finding**: Error #6.1 -- MECHA_PORT parsed without validation
- **Fix**: Import and use `parsePort()` from shared/validation.ts.
- **Effort**: 5 minutes
- **Files to modify**: `agent/entry.ts`

**3.8 Fix config_path symlink bypass**
- **Finding**: Security #11 -- resolve() doesn't follow symlinks, empty HOME fallback
- **Fix**: Use `realpathSync()` and throw error when HOME is not set.
- **Effort**: 15 minutes
- **Files to modify**: `src/dashboard-server.ts`

**3.9 Apply chmod 0600 to mecha.json**
- **Finding**: Security #7 -- Headscale API key in plaintext without file permissions
- **Fix**: Add `chmodSync(settingsPath, 0o600)` after atomic write.
- **Effort**: 5 minutes
- **Files to modify**: `src/store.ts`

**3.10 Add redirect: "manual" to proxy fetch**
- **Finding**: Security #4 -- SSRF via dashboard proxy
- **Fix**: Add `redirect: "manual"` to the fetch call in the bot proxy handler.
- **Effort**: 5 minutes
- **Files to modify**: `src/dashboard-server.ts`

**3.11 Multi-arch Dockerfile**
- **Finding**: Architecture A5 -- Hardcoded x86_64
- **Fix**: Use `TARGETARCH` build arg to select correct s6-overlay binary.
- **Effort**: 2 hours
- **Files to modify**: `Dockerfile`

**3.12 Add rate limiting on prompt endpoint**
- **Finding**: Security #10 -- No rate limiting / cost ceiling
- **Fix**: Add per-IP rate limiter (e.g., 10 prompts/minute) and daily cost ceiling config option.
- **Effort**: 3 hours
- **Files to modify**: `agent/server.ts`, `agent/types.ts`

**3.13 Use TS_AUTHKEY env var for Tailscale**
- **Finding**: Security #9, Edge #13 -- Auth key in cmdline args
- **Fix**: Use `TS_AUTHKEY` environment variable instead of `--auth-key` flag.
- **Effort**: 15 minutes
- **Files to modify**: `s6/tailscale-up/up`

### Phase 4: Low-priority cleanup (when touching these files)

**agent/server.ts:**
- Convert `requireAuth()` manual calls to Hono middleware (Architecture A11)
- Add runtime validation for SDK message types instead of `as` casts (Architecture A13)

**agent/costs.ts:**
- Switch from floating-point USD to integer cents (Edge #12)

**agent/scheduler.ts:**
- Store Cron job reference directly on entry instead of index correlation (Edge #9, Error #5.2)

**agent/event-log.ts:**
- Distinguish ENOENT from other errors in readEvents (Error #2.3)

**src/cli.ts:**
- Extract shared SSE parser to `shared/sse-parser.ts` (Architecture A12)
- Fix misleading headscale pull error message (Error #2.4)

**src/docker.ts:**
- Add orphan container detection command (Architecture A3)
- Validate workspace paths more strictly (Security #12)
- Use project root instead of cwd() for buildImage (Edge #14)

**shared/logger.ts:**
- Add coverage for `access_token`, `apikey` (no camelCase) in redaction keys

### Dependency Graph

- Fix 1.2 (dashboard token) depends on Fix 1.1 (bot token generation) for consistent token pattern
- Fix 2.4 (registry locking) should be done before Fix 3.2 (bot-to-bot auth) since spawning bots for mesh auth testing triggers concurrent registry writes
- Fix 2.2 (vitest) should be done before Fix 2.3 (CI) since CI runs the tests
- Fix 2.7 (non-root container) should be tested after Fix 2.5 (event log rotation) since file ownership affects log writes

### Estimated Total Effort

- **Phase 1**: 5 hours (Critical -- do immediately)
- **Phase 2**: 19 hours (~2.5 days)
- **Phase 3**: 19 hours (~2.5 days)
- **Phase 4**: 8 hours (opportunistic)
- **Total**: ~51 hours (~6.5 working days)
