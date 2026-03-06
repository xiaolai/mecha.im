# Documentation Audit Report

**Project**: mecha.im
**Date**: 2026-03-06
**Language**: TypeScript
**Framework**: VitePress

## Executive Summary

| Dimension | Score | Status |
|-----------|-------|--------|
| Freshness | 100/100 | 🟢 |
| Accuracy  | 78/100 | 🟡 |
| Coverage  | 52% (inline) / 60% (combined) | 🔴 |
| Quality   | 92/100 | 🟢 |

**Overall health**: 78/100

The docs are **fresh and well-structured** with excellent external documentation (CLI, architecture, features). Primary gaps: 4 factual inaccuracies in metering/env docs, and inline JSDoc coverage at 52%.

## Critical Findings (fix immediately)

None.

## High Findings (fix soon)

### Coverage — Worst Packages

**[HIGH]** `packages/mcp-server` — 5% inline coverage (22 exports, 1 documented)
- `createMeshMcpServer()`, `runHttp()`, `runStdio()`, `createRateLimiter()`, `createAuditLog()` — all undocumented

**[HIGH]** `packages/runtime` — 14% inline coverage (35 exports, 5 documented)
- `createServer()`, `createSessionManager()`, `createScheduleEngine()` — core runtime factories undocumented

**[HIGH]** `packages/agent` — 27% inline coverage (66 exports, 18 documented)
- `createAgentServer()`, `createPtyManager()`, `createEventLog()` — main entry points undocumented
- 16 `register*Routes()` functions lack any JSDoc

**[HIGH]** `packages/service` — 33% inline coverage (75 exports, 25 documented)
- 11 `mechaAuth*()` functions, 7 `botSchedule*()` functions, 3 `botSession*()` functions — all undocumented

## Medium Findings (fix soon)

### Accuracy Mismatches

**[MEDIUM]** Metering snapshot interval: doc says 10s, code says 5s
- Doc: `website/docs/features/metering.md:126`
- Code: `packages/meter/src/daemon.ts` uses `5_000`ms
- Fix: Change doc table to show `5s`

**[MEDIUM]** Metering event buffer doesn't exist — doc describes a buffer that isn't implemented
- Doc: `website/docs/features/metering.md:129-130` — "Event buffer max | 100 events"
- Code: Events are written synchronously via `appendFileSync` per event — no buffer
- Fix: Remove the two "Event buffer" rows from the internals table

**[MEDIUM]** Metering rollup interval is not a periodic timer
- Doc: `website/docs/features/metering.md:127` — "Rollup interval | 60s"
- Code: Rollups update inline per event, flushed on shutdown. Only 2 timers: snapshot (5s) + registry (30s)
- Fix: Remove "Rollup interval" row or clarify inline behavior

**[MEDIUM]** `SERVER_SECRET_PATH` env var documented but doesn't exist in code
- Doc: `website/docs/reference/environment.md:16`
- Code: Zero matches across all packages
- Fix: Remove from docs or implement the feature

### Quality

**[MEDIUM]** Potential fragile anchor link in dashboard.md:224 → `architecture#authentication-system`

## Low Findings (nice to have)

- **VitePress frontmatter**: 19 of 20 doc files lack `---` frontmatter (SEO impact)
- **Cross-references**: CLI reference (1407 lines) lacks "See also" links to feature pages
- **Environment docs**: No `.env` usage examples
- **Dashboard doc**: Says "in-process Next.js application" — should say "pre-built SPA"
- **`MECHA_LOG_DIR`**: Documented as runtime env var but not in RuntimeEnv Zod schema
- **Multi-agent doc**: Thin content (93 lines), could add workflow patterns
- **Architecture doc**: 774 lines — consider splitting if it grows

## Fixing Plan

1. **Fix 3 metering doc inaccuracies** — snapshot 10s→5s, remove phantom event buffer/rollup rows
2. **Remove `SERVER_SECRET_PATH`** from environment.md
3. **Fix dashboard doc** — "Next.js" → "pre-built SPA"
4. **Add JSDoc to mcp-server** (22 exports) — worst coverage, user-facing
5. **Add JSDoc to runtime** (35 exports) — core factories
6. **Add JSDoc to agent** (66 exports) — primary API surface
7. **Add JSDoc to service** (75 exports) — business logic layer
8. **Add VitePress frontmatter** to all 19 doc files
9. **Add cross-reference links** to CLI reference and environment docs

## Full Agent Reports

<details>
<summary>Staleness Report</summary>

**Score**: 100/100 — All 20 mappings fresh (0 stale)

| # | Source | Doc | Gap | Status |
|---|--------|-----|-----|--------|
| 1 | `packages/cli/src/commands/**` | `reference/cli.md` | 0d | FRESH |
| 2 | `packages/agent/src/**` | `reference/architecture.md` | 1d | FRESH |
| 3 | `packages/runtime/src/**` | `reference/architecture.md` | 0d | FRESH |
| 4 | `packages/core/src/acl/**` | `features/permissions.md` | 0d | FRESH |
| 5 | `packages/sandbox/src/**` | `features/sandbox.md` | 0d | FRESH |
| 6 | `packages/meter/src/**` | `features/metering.md` | 0d | FRESH |
| 7 | `packages/connect/src/**` | `features/mesh-networking.md` | 0d | FRESH |
| 8 | `packages/server/src/**` | `features/mesh-networking.md` | 0d | FRESH |
| 9 | `packages/core/src/schedule.ts` | `features/scheduling.md` | 0d | FRESH |
| 10 | `packages/cli/src/commands/schedule*.ts` | `features/scheduling.md` | 0d | FRESH |
| 11 | `packages/runtime/src/scheduler.ts` | `features/scheduling.md` | 0d | FRESH |
| 12 | `packages/mcp-server/src/**` | `features/mcp-server.md` | 0d | FRESH |
| 13 | `packages/runtime/src/session-manager.ts` | `features/sessions.md` | 0d | FRESH |
| 14 | `packages/agent/src/routes/sessions.ts` | `features/sessions.md` | 0d | FRESH |
| 15 | `packages/core/src/types.ts` | `guide/concepts.md` | 0d | FRESH |
| 16 | `packages/core/src/schemas.ts` | `guide/configuration.md` | 0d | FRESH |
| 17 | `packages/runtime/src/env.ts` | `reference/environment.md` | 0d | FRESH |
| 18 | `packages/agent/src/routes/bots.ts` | `features/multi-agent.md` | 1d | FRESH |
| 19 | `packages/process/src/**` | `reference/architecture.md` | 1d | FRESH |
| 20 | `packages/spa/src/**` | `features/dashboard.md` | 1d | FRESH |

Watch list: Mappings 2, 18, 19, 20 have 1-day gaps from today's audit fix commit.

</details>

<details>
<summary>Accuracy Report</summary>

**Score**: 78/100 — 6 mismatches (0 critical, 0 high, 4 medium, 2 low)

**Verified accurate (31 items):** All CLI command signatures (start, stop, restart, bot spawn/stop/logs/chat/sessions, schedule add/history, node add/invite/join, meter start, mcp serve, agent start, budget set/rm/ls, cost). All port defaults (7660, 7700-7799, 7600, 7680, 7681). All ACL capabilities, sandbox modes, permission modes. BotConfig schema, RuntimeEnv schema. All environment variables. SessionManager API. Rate limiter defaults. All agent server routes. Metering retention/registry rescan.

**Findings:**
1. **[MEDIUM]** Snapshot interval 10s→5s
2. **[MEDIUM]** Phantom event buffer (synchronous writes, no buffer)
3. **[MEDIUM]** Phantom rollup interval (inline per-event, not periodic)
4. **[MEDIUM]** `SERVER_SECRET_PATH` env var doesn't exist in code
5. **[LOW]** Dashboard described as "Next.js" (actually SPA)
6. **[LOW]** `MECHA_LOG_DIR` not in RuntimeEnv Zod schema

</details>

<details>
<summary>Coverage Report</summary>

**Score**: 51.5% inline / ~60% combined — 781 public symbols, 402 documented

| Package | Exports | Documented | Coverage |
|---------|---------|------------|----------|
| sandbox | 19 | 18 | 95% |
| spa | 14 | 11 | 79% |
| meter | 99 | 71 | 72% |
| core | 222 | 150 | 68% |
| connect | 61 | 39 | 64% |
| server | 29 | 18 | 62% |
| process | 43 | 24 | 56% |
| service | 75 | 25 | 33% |
| agent | 66 | 18 | 27% |
| cli | 96 | 22 | 23% |
| runtime | 35 | 5 | 14% |
| mcp-server | 22 | 1 | 5% |

External docs fully cover: CLI commands (cli.md), API routes (architecture.md), env vars (environment.md).

Worst offenders (0% inline): mcp-server (audit, rate-limit, types), agent (login-limiter, pty-manager, server, 16 route files), runtime (schedule-runner, server), service (bot, schedule, sessions, locator), process (types, spawn-pipeline).

</details>

<details>
<summary>Quality Report</summary>

**Score**: 92/100 — 20 files, 11 findings (0 critical, 0 high, 1 medium, 10 low)

| File | Structure | Examples | Links | Completeness | Score |
|------|-----------|----------|-------|--------------|-------|
| guide/quickstart.md | 10 | 10 | 10 | 10 | 97 |
| reference/cli.md | 10 | 10 | 8 | 10 | 95 |
| features/mesh-networking.md | 10 | 10 | 8 | 10 | 95 |
| features/mcp-server.md | 10 | 10 | 8 | 10 | 95 |
| guide/concepts.md | 10 | 10 | 9 | 10 | 95 |
| guide/installation.md | 10 | 10 | 9 | 10 | 95 |
| advanced/multi-machine.md | 10 | 10 | 8 | 10 | 95 |
| features/permissions.md | 10 | 10 | 8 | 10 | 93 |
| features/sandbox.md | 10 | 9 | 8 | 10 | 93 |
| features/metering.md | 10 | 10 | 8 | 10 | 93 |
| features/scheduling.md | 10 | 10 | 8 | 10 | 93 |
| features/sessions.md | 10 | 10 | 8 | 10 | 93 |
| features/dashboard.md | 10 | 8 | 10 | 10 | 93 |
| guide/configuration.md | 10 | 10 | 8 | 10 | 93 |
| guide/index.md | 10 | 9 | 10 | 10 | 93 |
| advanced/troubleshooting.md | 10 | 10 | 9 | 10 | 93 |
| reference/architecture.md | 10 | 9 | 8 | 10 | 92 |
| index.md | 9 | 7 | 9 | 10 | 85 |
| reference/environment.md | 9 | 7 | 8 | 10 | 82 |
| features/multi-agent.md | 9 | 9 | 7 | 9 | 82 |

Strengths: Excellent structure, comprehensive code examples, no stubs/TODOs, consistent formatting.
Gaps: Missing VitePress frontmatter (19 files), limited cross-references in reference docs.

</details>
