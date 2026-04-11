# Documentation Audit Report

**Project**: mecha.im
**Date**: 2026-04-12
**Language**: Go
**Framework**: VitePress
**Source dirs**: `cmd/`, `internal/`, `docker/`
**Doc root**: `website/`

## Executive Summary

| Dimension | Score | Status |
|-----------|-------|--------|
| Freshness | 14/100  | 🔴 |
| Accuracy  | 74/100  | 🟡 |
| Coverage  | 100%    | 🟢 |
| Quality   | 97/100  | 🟢 |

**Overall health**: 71/100

The docs have **perfect coverage and near-perfect quality**, but **accuracy and freshness are weak** because the recent grill-fix burst (33 commits across 2 days) changed code faster than the VitePress site. 19 of 22 mapped pages trail code by 1–9 days, and 22 content mismatches were found — 3 CRITICAL, 8 HIGH.

## Critical Findings (fix immediately)

### CRITICAL-1: Graceful shutdown drain timeout wrong — 30s documented, 10m actual

- **File**: `website/guide/server.md:141`
- **Code**: `internal/serve/server.go:70` — `drain = 10 * time.Minute` (overridable via `MECHA_DRAIN_TIMEOUT` env var)
- **Doc says**: `"HTTP server stops accepting new requests (30s drain)"`
- **Fix**: Change to 10 minutes and document `MECHA_DRAIN_TIMEOUT` override.

### CRITICAL-2: Health check timeout wrong — 30s documented, 90s actual

- **File**: `website/guide/cli.md:61`
- **Code**: `internal/cli/docker_cmds.go:15` — `persistentHealthTimeout = 90 * time.Second`
- **Doc says**: `"If health doesn't pass within 30 seconds, the container is stopped and removed."`
- **Fix**: Update to 90 seconds (commit `f50f7b31`). Mention the 60s first-boot CLI install cost.

### CRITICAL-3: Architecture diagram health timeout wrong — 30s documented, 90s actual

- **File**: `website/guide/architecture.md:151`
- **Code**: `internal/cli/docker_cmds.go:15` — 90s.
- **Doc**: Mermaid sequence diagram shows `"loop Every 2s, max 30s"`.
- **Fix**: Update mermaid to `max 90s`.

### HIGH-1: `mecha worker ls` column order wrong in adapters.md

- **File**: `website/guide/adapters.md:100-102`
- **Code**: `internal/cli/worker_ls.go:27` — `"NAME\tTYPE\tSTATE\tENDPOINT\tHEALTH"`
- **Doc**: Shows `"NAME STATE TYPE ..."` (STATE and TYPE swapped)
- **Fix**: Swap columns to match code.

### HIGH-2: `mecha worker start` for adapters contradicts code

- **File**: `website/guide/adapters.md:82,96-97`
- **Code**: `internal/cli/worker.go:148-149` — returns error: `"adapter workers run in-process and must be started via 'mecha serve'"`
- **Doc**: Shows `mecha worker start local-ollama` as a working example.
- **Fix**: Remove the example and state that adapters auto-start via `mecha serve`.

### HIGH-3: SQLite migrations stale — V1-V5 documented, V1-V7 actual

- **Files**: `website/guide/architecture.md:71`, `website/guide/server.md:157`
- **Code**: `internal/store/db.go:66-73` — migrations up to V7.
- **Fix**: Update both references to `V1-V7`.

### HIGH-4: Background loops table missing `writeBackRetryLoop`

- **File**: `website/guide/server.md:129-136`
- **Code**: `internal/serve/server.go:160` starts `writeBackRetryLoop` (interval=30s, `internal/serve/writeback_retry.go:9`).
- **Doc**: Says `"four background loops"`, lists retry/pending/reconcile/rate-limiter.
- **Fix**: Change to `"five"` and add `Write-back retry | 30s | Retries events whose write-back failed transiently`.

### HIGH-5: `docker.resources.pids` default wrong — "unlimited" documented, 1024 actual

- **File**: `website/guide/workers.md:62`
- **Code**: `internal/workers/docker.go:151-155` — defaults `PidsLimit = 1024` with fork-bomb comment.
- **Fix**: Change default to `1024`, note the fork-bomb rationale.

### HIGH-6: `WORKER_BACKEND` listed as reserved but not enforced in code

- **Files**: `website/guide/secrets.md:147`
- **Code**: `internal/cli/helpers.go:6-10` — reserved keys are only `worker_port`, `worker_api_key`, `worker_timeout`, `worker_dry_run`, `home`. Unit test `internal/cli/coverage_max_test.go:34` asserts `{"WORKER_BACKEND", false}`.
- **Fix**: Drop `WORKER_BACKEND` from secrets.md.

### HIGH-7: `adapter.token` field undocumented (new as of today)

- **Files**: `website/guide/workers.md:156-161`, `website/guide/adapters.md:57-62`
- **Code**: `internal/workers/config.go:32` — `Token string yaml:"token,omitempty"` added this session for restart-safe secret persistence.
- **Fix**: Add `adapter.token` row to both field tables, explain it as a `secrets.yml` reference (e.g. `codex.default`) distinct from the in-memory `api_key`.

### HIGH-8: `write_back_failed` event state missing from events.md

- **File**: `website/guide/events.md:209-219`
- **Code**: `internal/events/types.go:28` — `StateWriteBackFailed State = "write_back_failed"` is a non-terminal transient state.
- **Doc**: Mermaid state diagram omits it; prose still claims `"write-back failure keeps event dispatched"`.
- **Fix**: Add `write_back_failed` to the diagram and drop the stale prose.

## Medium Findings (fix soon)

| # | File:Line | Issue | Fix |
|---|---|---|---|
| 1 | `website/guide/mcp-server.md:20,170` | Default listen address doc says `:8090`; code is `127.0.0.1:8090` | Prepend `127.0.0.1` |
| 2 | `website/guide/index.md:63` | Says "Four Nouns" but `.claude/rules/domain-model.md` says five (Log missing) | Reconcile count or note Log is internal |
| 3 | `website/guide/architecture.md:124-135` | Worker state diagram missing `busy` state | Add `busy` to match workers.md |
| 4 | `website/guide/workers.md:66` | `docker.credentials` × `docker.token` mutual exclusion not in field table | Add row note |
| 5 | `website/guide/dual-agent.md:170` | Broken anchor link `#claude-env-vars` | Change to `#backend-specific-env-vars` |
| 6 | 19 staleness pairs | Docs trail recent grill-fix hotfixes by 1–9 days | Refresh docs after grill fix cycle completes |

## Low Findings (nice to have)

- `website/guide/workers.md:198-209` — `POST /task` response example omits `comment`/`status`/`labels`/`commit` (minimal but technically correct).
- `website/guide/server.md:90-103` — `/metrics` sample list incomplete; new counters not reflected.
- `website/guide/server.md:90,112` — Two code fences missing language tag (`text`/`prometheus`).
- `website/index.md:1-36` — Missing explicit `title`/`description` frontmatter (layout: home falls back to site config).
- `website/guide/go-api.md:1-466` — 466-line reference with zero code examples.
- 20 internal symbols (godoc present, no website mention) — mostly intentional plumbing but the Write-Back Retry feature (5 symbols) deserves a dedicated doc section.
- 6 adapter interface methods missing godoc (acceptable per Go convention when interface contract is documented).

## Fixing Plan

Priority-ordered, grouped for efficient editing:

### Phase 1: Critical (one editing session)

1. **Bulk fix timeout drift** — update 3 locations (`server.md`, `cli.md`, `architecture.md`) for 30s→10m drain and 30s→90s health.
2. **Add missing writeBackRetryLoop** to `server.md` background loops table (also update count from "four" to "five").
3. **Add `write_back_failed` state** to `events.md` mermaid diagram and prose.

### Phase 2: High accuracy fixes (one editing session)

4. **`adapter.token` field** — add to `workers.md` and `adapters.md` field tables (new feature, today's commit).
5. **Fix adapter lifecycle contradiction** — `adapters.md:82,96-97` must say adapters auto-start via `mecha serve`, not `mecha worker start`.
6. **Fix `mecha worker ls` columns** in `adapters.md` (TYPE before STATE).
7. **Bump migration version** V1-V5 → V1-V7 in `architecture.md` and `server.md`.
8. **Fix `docker.resources.pids` default** in `workers.md` (unlimited → 1024).
9. **Drop `WORKER_BACKEND`** from `secrets.md` reserved-keys list.

### Phase 3: Medium consistency (one editing session)

10. Fix `mcp-server.md` listen address (`:8090` → `127.0.0.1:8090`).
11. Reconcile "Four Nouns" vs "Five Nouns" in `index.md` ↔ `domain-model.md`.
12. Add `busy` to `architecture.md` worker state diagram.
13. Document `docker.credentials` × `docker.token` mutual exclusion.
14. Fix broken anchor `dual-agent.md:170`.

### Phase 4: Low polish (opportunistic)

15. Add language tags to `server.md:90,112` code fences.
16. Expand `POST /task` response example in `workers.md`.
17. Add explicit title/description to `website/index.md`.
18. Write a Write-Back Retry section in `events.md` or a new page.
19. Add one-line godoc comments to the 6 adapter methods.
20. Sprinkle code examples into `go-api.md` package sections.

### Phase 5: Batch refresh (after grill-fix burst settles)

21. Update the 19 stale doc pages to match the week of hotfixes (configurable queue, cron drop counter, EMA/histogram latency, adapter secret persistence, etc.).

## Full Agent Reports

<details>
<summary>Staleness Report (freshness = 14/100)</summary>

**Summary**: 3 fresh pairs, 19 MEDIUM (1–9 days behind), 0 HIGH. Average staleness 7.4 days. Max 9 days.

Fresh pairs:
- `cmd/mecha/main.go` → `website/guide/index.md` (−3 days, doc newer)
- `internal/workers/docker_inspect.go` → `website/guide/cli.md` (0)
- `internal/workers/health.go` → `website/guide/workers.md` (0)

Stale pairs (all MEDIUM, 1–9 days):

| Source | Doc | Days |
|---|---|---:|
| internal/events/ | events.md | 8 |
| internal/source/ | events.md | 8 |
| internal/workers/registry.go | architecture.md | 8 |
| internal/writeback/ | architecture.md | 8 |
| internal/tasks/ | architecture.md | 8 |
| internal/store/ | architecture.md | 8 |
| internal/workers/config.go | workers.md | 8 |
| internal/workers/docker.go | workers.md | 8 |
| internal/workers/container.go | workers.md | 8 |
| internal/workers/types.go | workers.md | 8 |
| internal/workers/validate.go | workers.md | 1 |
| internal/workers/secrets.go | secrets.md | 8 |
| internal/cli/ | cli.md | 8 |
| internal/serve/ | server.md | 8 |
| internal/policies/ | policy.md | 8 |
| internal/adapter/ | adapters.md | 9 |
| docker/ | installation.md | 8 |
| docker/runtime/backends/ | dual-agent.md | 9 |
| cmd/mecha-mcp/ | mcp-server.md | 8 |

Interpretation: Zero crossed the 30-day HIGH threshold, but 19/22 pairs trail the current grill-fix burst. Five features land in today's commits and need doc updates before the next release: write-back retry state, configurable dispatch queue, 90s first-boot health timeout, adapter secret persistence, `cmd/mecha-mcp` config unification.

</details>

<details>
<summary>Accuracy Report (accuracy = 74/100)</summary>

**Summary**: 22 mismatches found across ~85 checked symbols. 3 CRITICAL, 8 HIGH, 7 MEDIUM, 4 LOW.

All 22 findings listed in the Critical/High/Medium sections above.

Key code sources:
- `internal/serve/server.go` (drain timeout default 10m)
- `internal/cli/docker_cmds.go` (health timeout 90s)
- `internal/cli/helpers.go` (reserved env keys — no WORKER_BACKEND)
- `internal/cli/worker.go` (adapter start rejection)
- `internal/cli/worker_ls.go` (column order NAME/TYPE/STATE/ENDPOINT/HEALTH)
- `internal/store/db.go` (migration versions V1-V7)
- `internal/workers/config.go` (`adapter.token` field, new)
- `internal/workers/docker.go` (default PID limit 1024)
- `internal/workers/types.go` (worker states including busy)
- `internal/events/types.go` (`write_back_failed` state)
- `internal/serve/writeback_retry.go` (new retry loop)
- `cmd/mecha-mcp/main.go` (default addr 127.0.0.1:8090)

</details>

<details>
<summary>Coverage Report (coverage = 100%)</summary>

**Summary**: 256 public symbols across 51 files (90 scanned), all covered by godoc or VitePress mention. HIGH=0, MEDIUM=6, LOW=20.

**MEDIUM (6)** — interface-satisfaction methods without godoc:
- `internal/adapter/ollama.go:29,31,47` — `Name`, `Health`, `SendTask`
- `internal/adapter/openai.go:32,34,53` — `Name`, `Health`, `SendTask`

**LOW (20)** — godoc exists but not referenced in website:
- Write-Back Retry (5 symbols): `events/store.go:177,194,208,216`, `events/types.go:28`
- Sentinel errors: `events/helpers.go:14`, `tasks/helpers.go:13` (`ErrNotFound`)
- Logs: `logs/store.go:52,119` (`Query`, `Prune`)
- Rate limiter: `serve/ratelimit.go:38,69` (`Allow`, `Cleanup`)
- Hot-reload: `serve/reload.go:17` (`ReloadSecrets`)
- Hydration: `source/github_hydrate.go:28` (`Hydrate`)
- Retry ceiling: `tasks/retry.go:16` (`RetryMaxDelay`)
- Docker cleanup: `workers/docker_cleanup.go:14`
- SSRF guard: `workers/url_validate.go:30` (`ValidateUpstreamURL`)
- Registry: `workers/registry.go:156` (`Recover`)
- Validation: `workers/validate.go:59,115`
- Writeback: `writeback/writeback.go:40` (`UpdateToken`)

</details>

<details>
<summary>Quality Report (quality = 97/100)</summary>

**Summary**: 16 files scanned, average score 96.6/100. 1 Medium, 4 Low.

| File | Score |
|---|---|
| quickstart, installation, workers, adapters, secrets, events, policy, cli, mcp-server, api, architecture | 100 |
| guide/index.md | 98 |
| go-api.md | 97 |
| index.md (root) | 85 |
| server.md | 85 |
| dual-agent.md | 80 |

**MEDIUM (1)**:
- `dual-agent.md:170` — broken anchor `#claude-env-vars` (should be `#backend-specific-env-vars`)

**LOW (4)**:
- `server.md:90,112` — code fences without language tag
- `index.md:1-36` — missing explicit `title`/`description` frontmatter (layout: home fallback)
- `go-api.md:1-466` — 466-line Go API reference with zero code examples

**Verified clean**: heading hierarchy, sidebar coverage (no orphans), relative links, no TODO/TBD/WIP markers, all pages under 1000 lines, mermaid fences well-formed, code-group blocks correct.

</details>
