# Documentation Audit Report

**Project**: mecha.im
**Date**: 2026-03-04
**Language**: TypeScript
**Framework**: Monorepo (pnpm workspaces) — Fastify runtime, Next.js dashboard, Commander CLI

## Executive Summary

| Dimension | Score | Status |
|-----------|-------|--------|
| Freshness | 85/100 | :yellow_circle: |
| Accuracy  | 93/100 | :green_circle: |
| Coverage  | 25%    | :red_circle: |
| Quality   | 94/100 | :green_circle: |

**Overall health**: 56/100

The documentation is **accurate and well-structured** for what it covers, but **coverage is critically low** — only 75 of 305 public API symbols are documented. CLI commands and runtime APIs are excellent; library-level programmatic APIs are almost entirely absent.

## Critical Findings (fix immediately)

None. No critical issues found across any dimension.

## High Findings (fix soon)

### H1: Library API coverage at 25% (Coverage)

305 public symbols across 11 packages; only 75 documented. Worst offenders:

| Package | Exports | Documented | Coverage |
|---------|---------|------------|----------|
| `@mecha/connect` | 38 | 3 | 8% |
| `@mecha/process` | 22 | 2 | 9% |
| `@mecha/service` | 38 | 4 | 11% |
| `@mecha/server` | 18 | 2 | 11% |
| `@mecha/meter` | 42 | 7 | 17% |
| `@mecha/sandbox` | 11 | 2 | 18% |
| `@mecha/core` | 97 | 22 | 23% |
| `@mecha/cli` | 3 | 0 | 0% |

Well-covered: `@mecha/mcp-server` (100%), `@mecha/runtime` (90%), `@mecha/agent` (80%).

### H2: 8 undocumented high-priority API functions (Coverage)

- `createProcessManager` / `prepareBotFilesystem` (`@mecha/process`) — core bot lifecycle
- `createConnectManager` / `createSecureChannel` / `channelFetch` (`@mecha/connect`) — P2P core
- `createProgram` / `createFormatter` (`@mecha/cli`) — CLI extension API
- `botScheduleAdd/Remove/List/Pause/Resume/Run/History` (`@mecha/service`) — schedule service layer
- `mechaInit` / `mechaDoctor` (`@mecha/service`) — init/doctor service layer

## Medium Findings (fix soon)

### M1: Stale `/home/` paths in architecture.md (Staleness)

`website/docs/reference/architecture.md` still references the old `home/` directory in the bot filesystem layout. The recent flatten-bot-home refactor removed this nesting — `.claude/` is now directly under the bot root.

**File**: `website/docs/reference/architecture.md`
**Fix**: Update the bot directory tree diagram to remove the `home/` level.

### M2: Package count says "13" — should be "12" (Accuracy)

`website/docs/reference/architecture.md` states "13 packages" but the monorepo has 12 (after the `@mecha/ui` merge).

**File**: `website/docs/reference/architecture.md`
**Fix**: Change "13" to "12" in the package count.

### M3: Missing `POST /bots/batch` in route summary table (Accuracy)

The batch stop/restart endpoint was added but is missing from the API route summary table in architecture.md.

**File**: `website/docs/reference/architecture.md`
**Fix**: Add `POST /bots/batch` row to the Agent HTTP API table.

### M4: `mecha_query` section is stubbed (Quality)

`website/docs/features/mcp-server.md` has a `mecha_query` tool section that says "Coming soon" with no content.

**Fix**: Either document it or remove the stub section.

### M5: 28+ error classes undocumented (Coverage)

All error types exported from `@mecha/core` (`MechaError`, `BotNotFoundError`, `AclDeniedError`, `ScheduleNotFoundError`, etc.) have no reference documentation listing their properties or when they are thrown.

### M6: Plugin registry API undocumented (Coverage)

The full plugin registry module (`readPluginRegistry`, `addPlugin`, `removePlugin`, `getPlugin`, `listPlugins`, etc.) from `@mecha/core` is exported but has no programmatic documentation.

### M7: ~20 Medium-priority undocumented APIs (Coverage)

Including: Noise/STUN/rendezvous primitives (`@mecha/connect`), meter proxy pipeline (`@mecha/meter`), sandbox factory (`@mecha/sandbox`), server factory (`@mecha/server`), service routing (`@mecha/service`), auth resolution (`@mecha/core`), gossip/vector-clock (`@mecha/server`).

## Low Findings (nice to have)

| # | Finding | Source |
|---|---------|--------|
| L1 | Missing TOC in 4 long doc pages (scheduling, metering, sandbox, mesh-networking) | Quality |
| L2 | Dense sections without examples in architecture.md (Process Events, Discovery) | Quality |
| L3 | `cost` command shows UTC — docs should note timezone suffix | Accuracy |
| L4 | ~40 low-priority undocumented exports across all packages | Coverage |
| L5 | Several doc pages exceed 300 lines without section breaks | Quality |

## Fixing Plan

Priority-ordered actions:

1. **Fix stale paths** (M1) — Update architecture.md bot filesystem diagram to remove `home/` nesting. ~5 min.
2. **Fix accuracy issues** (M2, M3) — Correct package count to 12, add batch route to API table. ~5 min.
3. **Stub or remove `mecha_query`** (M4) — Either document the tool or remove the "Coming soon" stub. ~2 min.
4. **Add error reference** (M5) — Create a table of all error classes with status codes and when thrown. ~30 min.
5. **Add library API docs for top packages** (H1, H2) — Start with `@mecha/process`, `@mecha/service`, `@mecha/connect` as they have the highest user impact. This is a large effort best done incrementally.
6. **Add TOCs to long pages** (L1) — Auto-generate or add manual TOCs. ~15 min.

## Coverage Breakdown by Package

| Package | Total | Documented | Coverage |
|---------|-------|------------|----------|
| `@mecha/agent` | 5 | 4 | 80% |
| `@mecha/cli` | 3 | 0 | 0% |
| `@mecha/connect` | 38 | 3 | 8% |
| `@mecha/core` | 97 | 22 | 23% |
| `@mecha/mcp-server` | 11 | 11 | 100% |
| `@mecha/meter` | 42 | 7 | 17% |
| `@mecha/process` | 22 | 2 | 9% |
| `@mecha/runtime` | 20 | 18 | 90% |
| `@mecha/sandbox` | 11 | 2 | 18% |
| `@mecha/server` | 18 | 2 | 11% |
| `@mecha/service` | 38 | 4 | 11% |
| **Total** | **305** | **75** | **25%** |

## Full Agent Reports

<details>
<summary>Staleness Report</summary>

**Score**: 85/100

All documentation was updated on the same day (2026-03-04) as the latest code changes. The primary staleness issue is the bot filesystem layout in `architecture.md` which still references the old `home/` directory nesting that was removed in the flatten-bot-home refactor.

Other pages (cli.md, scheduling.md, metering.md, sandbox.md, mesh-networking.md, mcp-server.md) are all current with their corresponding source code.

</details>

<details>
<summary>Accuracy Report</summary>

**Score**: 93/100

**MEDIUM findings:**
1. Package count "13" should be "12" in architecture.md (after @mecha/ui merge)
2. `POST /bots/batch` endpoint missing from the Agent HTTP API route summary table

**LOW findings:**
1. `mecha cost` output uses UTC dates — docs should mention the timezone suffix for clarity

All CLI command signatures, option flags, default values, and examples match their source implementations. Schedule, sandbox, metering, and mesh-networking docs are accurate.

</details>

<details>
<summary>Coverage Report</summary>

**Score**: 25% (75/305 symbols documented)

**Key observations:**
- CLI commands are excellently documented (cli.md is comprehensive)
- `@mecha/runtime` (90%) and `@mecha/agent` (80%) are well-covered
- `@mecha/mcp-server` is fully documented (100%)
- `@mecha/connect` is the largest gap — 38 exports, only 3 mentioned conceptually
- `@mecha/core` has 97 exports but only 23% documented (missing: 28+ error types, plugin registry, auth resolution, TOTP storage, identity/crypto)
- `@mecha/service` is almost entirely undocumented as a library (38 exports, 4 documented)
- Docs describe *features* thoroughly but *library APIs* almost not at all

**8 HIGH-priority undocumented functions**: createProcessManager, prepareBotFilesystem, createConnectManager, createSecureChannel, channelFetch, createProgram, createFormatter, botSchedule* service functions, mechaInit, mechaDoctor.

**~25 MEDIUM-priority undocumented APIs**: Noise/STUN/rendezvous primitives, meter proxy pipeline, sandbox factory, server factory, service routing, auth resolution, gossip/vector-clock, batch operations, error types, plugin registry, TOTP storage.

**~40 LOW-priority undocumented exports**: Budget storage, SSE parsing, pricing functions, event storage, schedule persistence, process event emitter, log reader, node registry, validation constants, bot config read/write, discovery filter, address utilities.

</details>

<details>
<summary>Quality Report</summary>

**Score**: 93.7/100

**MEDIUM findings:**
1. `mecha_query` tool section in mcp-server.md is stubbed ("Coming soon") with no content

**LOW findings (11):**
1. Missing table of contents in scheduling.md (200+ lines)
2. Missing table of contents in metering.md (250+ lines)
3. Missing table of contents in sandbox.md (200+ lines)
4. Missing table of contents in mesh-networking.md (300+ lines)
5. Dense "Process Events" section in architecture.md lacks examples
6. Dense "Discovery" section in architecture.md could use a flow diagram
7. Configuration guide has long unbroken lists of options
8. Environment variables page could group vars by subsystem
9. CLI reference could add "See also" cross-links between related commands
10. Permissions page ACL table could link to relevant CLI commands
11. Multi-machine guide could add a troubleshooting section

Overall structure, formatting, heading hierarchy, and code examples are strong across all pages.

</details>
