# Documentation Audit Report

**Project**: mecha.im
**Date**: 2026-03-21
**Language**: TypeScript
**Framework**: VitePress
**Version**: v4.0.0 (local-first multi-agent runtime rewrite)

## Executive Summary

| Dimension | Score | Status |
|-----------|-------|--------|
| Freshness | 98/100 | Pass |
| Accuracy  | 67/100 | Needs work |
| Coverage  | 75%    | Needs work |
| Quality   | 93/100 | Good |

**Overall health**: 72/100

## Critical Findings (fix immediately)

### 1. [CRITICAL] `workflow run` will crash on all YAML workflow definitions

**Source**: `packages/cli/src/commands/workflow-run.ts:44-46`
**Doc**: `website/docs/features/workflow.md:24-44`

The code reads `<name>.yaml` files but calls `JSON.parse()` — YAML is not valid JSON. Any user following the YAML examples in the docs will get `SyntaxError: Unexpected token` at runtime. The entire workflow feature is broken as documented.

**Fix**: Either add a YAML parser (`js-yaml`) to `workflow-run.ts`, or change docs to use JSON format.

---

### 2. [HIGH] `@mecha/gateway` — entire package undocumented (20 exports, 0% coverage)

**Package**: `packages/gateway/src/`
**Exports**: `createCredentialStore`, `createCircuitBreaker`, `createHttpGateway`, `ADAPTER_REGISTRY`, `githubAdapter`, `slackAdapter`, `emailAdapter`, `discordAdapter`, `linearAdapter`, plus 11 types

No documentation file exists for this package. No feature page, no API reference.

**Fix**: Create `website/docs/features/gateway.md` and `website/docs/reference/api/gateway.md`.

---

### 3. [HIGH] 9 CLI command groups have no reference documentation (~30 commands)

Missing from `website/docs/reference/cli/`:

| Group | Commands | Status |
|-------|----------|--------|
| `mecha workflow` | 9 commands | No reference page |
| `mecha bus` | 8 commands | No reference page |
| `mecha team` | 5 commands | No reference page |
| `mecha meta` | 5 commands | No reference page |
| `mecha secret` | 4 commands | No reference page |
| `mecha alert` | 3 commands | No reference page |
| `mecha metrics` | 2 commands | No reference page |
| `mecha company` | 2 commands | No reference page |
| `mecha trace` | 2 commands | No reference page |

**Fix**: Add CLI reference pages for each group.

---

### 4. [HIGH] `@mecha/agent` — 9 of 10 exports undocumented (10% coverage)

**Package**: `packages/agent/src/` (newly created)
**Undocumented**: `createAgentServer`, `AgentServerOptions`, `deriveSessionKey`, `createSessionToken`, `validateSessionToken`, `createAuthHook`, `createAuthContext`, `verifyRequestSignature`, `AuthConfig`, `AuthContext`

No dedicated `reference/api/agent.md` exists. The API index mentions `createAgentServer` briefly but uses wrong type name (`AgentServerOpts` vs actual `AgentServerOptions`).

**Fix**: Create `website/docs/reference/api/agent.md`.

---

### 5. [HIGH] Import example uses wrong package name

**Doc**: `website/docs/reference/cli/index.md:43`
**Code**: `packages/cli/package.json` — `"name": "mecha.im"`

Doc shows `import { createProgram } from "@mecha/cli"` but the package is `mecha.im`.

**Fix**: Update import examples to use `"mecha.im"`.

## Medium Findings (fix soon)

### 6. [MEDIUM] `teams.md` says CLI commands are "planned for a future phase" — they already exist

`team-deploy.ts`, `team-list.ts`, `team-status.ts`, `team-teardown.ts`, `team-sync.ts` are all implemented and registered. Remove the stale notice at `features/teams.md:115`.

### 7. [MEDIUM] `bot spawn` workspace warning claim is false

`bot.md:55` says "A warning is emitted if CWD is not under HOME." Code comment at `bot-spawn.ts:162`: "workspace outside bot HOME is normal — no warning needed." Remove the false claim.

### 8. [MEDIUM] MCP port confusion: `mecha start` hardcodes 7680, `mecha mcp serve` defaults to 7682

`start.ts:192` hardcodes port 7680 for embedded MCP. `DEFAULTS.MCP_HTTP_PORT = 7682` is used by standalone `mecha mcp serve`. Docs conflate these. Add clarifying note.

### 9. [MEDIUM] Homebrew install may not exist yet

`guide/installation.md` and `guide/quickstart.md` lead with `brew install xiaolai/tap/mecha`. The release workflow does update a Homebrew tap, but the v4.0.0 release build failed — the formula may not exist for v4. Verify or add a note.

### 10. [MEDIUM] `mecha node invite --expires` docs imply only 4 values accepted

Code accepts any `Nd/Nh/Nm/Ns` format. Docs list only `1h, 6h, 24h, 7d` as if those are the only valid values.

### 11. [MEDIUM] `@mecha/bus` (18%), `@mecha/workflow` (28%), `@mecha/observe` (28%) — feature pages list exports by name only

These packages have feature pages with name-only tables but no parameter signatures, type shapes, or interface definitions.

### 12. [MEDIUM] 4 VitePress docs missing YAML frontmatter

Files: `features/bus.md`, `features/observability.md`, `features/teams.md`, `features/workflow.md`

### 13. [MEDIUM] `@mecha/core` has 34 undocumented exports (71% coverage)

Major gaps: identity functions (15), ACL functions (5), auth resolution (7), TOTP storage (4), address utilities (4), validation functions (5), bot config (3).

## Low Findings (nice to have)

- `bot ls` output example in quickstart shows 4 columns; actual output has 6 (`Name`, `State`, `Port`, `PID`, `Tags`, `Node`)
- `configuration.md` env vars table is intentionally incomplete (links to full reference)
- `observability.md` package table missing `suggestPromptChange` export
- `workflow.md` package table missing `releaseLock`, `isLocked`, `createRemoteExecutor`
- `bus.md` package table missing `createReplicator`
- `--expose` CLI help text lists 6 capabilities; actual schema accepts 13

## Fixing Plan

Priority-ordered:

1. **Fix workflow YAML parsing bug** — add `js-yaml` to `workflow-run.ts` or change docs to JSON
2. **Create `reference/api/agent.md`** — document the new `@mecha/agent` package
3. **Create `features/gateway.md`** — document the `@mecha/gateway` package
4. **Add CLI reference pages** for: workflow, bus, team, meta, secret, alert, metrics, company, trace
5. **Fix import example** in `reference/cli/index.md` — `@mecha/cli` → `mecha.im`
6. **Remove stale notices** — teams "future phase" claim, bot spawn warning claim
7. **Add frontmatter** to bus.md, observability.md, teams.md, workflow.md
8. **Clarify MCP port split** (7680 embedded vs 7682 standalone)
9. **Expand package export tables** in bus, workflow, observe, teams docs
10. **Backfill `@mecha/core` API docs** — identity, ACL, auth, validation, config functions

## Package API Coverage

| Package | Exports | Documented | Coverage |
|---------|---------|------------|----------|
| @mecha/core | 116 | 82 | 71% |
| @mecha/service | 69 | 63 | 91% |
| @mecha/agent | 10 | 1 | 10% |
| @mecha/process | 31 | 28 | 90% |
| @mecha/connect | 55 | 55 | 100% |
| @mecha/meter | 56 | 56 | 100% |
| @mecha/mcp-server | 12 | 12 | 100% |
| @mecha/server | 21 | 21 | 100% |
| @mecha/runtime | 31 | 31 | 100% |
| @mecha/sandbox | 12 | 12 | 100% |
| @mecha/bus | 17 | 3 | 18% |
| @mecha/workflow | 18 | 5 | 28% |
| @mecha/observe | 25 | 7 | 28% |
| @mecha/teams | 11 | 5 | 45% |
| @mecha/gateway | 20 | 0 | 0% |
| **Total** | **504** | **381** | **76%** |

## CLI Coverage

| Documented | Undocumented | Total | Coverage |
|------------|-------------|-------|----------|
| 77 commands | 30 commands | 107 | 72% |

<details>
<summary>Staleness Report</summary>

All 26 source-to-doc mappings pass the 30-day threshold. The v4 rewrite (commit 4e0281d) updated all docs in sync. Post-v4 commits (agent package, lint fixes, VitePress SSR fix) are minor. One MEDIUM finding: the new `@mecha/agent` auth API surface is not yet documented.

</details>

<details>
<summary>Accuracy Report</summary>

17 mismatches found across 51 checked symbols/mappings. Accuracy rate: 67%.

- 1 CRITICAL: workflow YAML parsing bug
- 3 HIGH: wrong import package name, false bot spawn warning claim, MCP port confusion
- 7 MEDIUM: stale teams notice, node invite duration docs, workspace description
- 6 LOW: column headers, env vars table, missing exports in tables

</details>

<details>
<summary>Coverage Report</summary>

153 undocumented public symbols out of 611 total. Coverage: 74.9%.

Top gaps: @mecha/gateway (0%), @mecha/agent (10%), @mecha/bus (18%), @mecha/workflow (28%), @mecha/observe (28%).

30 CLI commands across 9 command groups have no reference documentation.

</details>

<details>
<summary>Quality Report</summary>

44 files scanned. Average quality: 93/100. 40 of 44 files have perfect scores.

4 files missing VitePress frontmatter: bus.md, observability.md, teams.md, workflow.md.

All files pass: title check, heading hierarchy, code block language tags, no broken links, no empty sections, no TODO/placeholder text.

</details>
