# Documentation Audit Report

**Project**: mecha.im
**Date**: 2026-03-29
**Language**: Go
**Framework**: VitePress

## Executive Summary

| Dimension | Score | Status |
|-----------|-------|--------|
| Freshness | 70/100 | 🟡 Same day, but architecturally stale |
| Accuracy  | 57/100 | 🔴 18 mismatches found |
| Coverage  | 0%     | 🔴 0 of 43 public symbols documented |
| Quality   | 85/100 | 🟡 Good structure, missing practical content |

**Overall health**: 40/100

The docs describe the full design vision while the code implements only Phase 2 (Worker lifecycle + Docker). Half the documented features are aspirational.

## Critical Findings (fix immediately)

### 1. [CRITICAL] AGENTS.md claims "SQLite persistence" — code uses JSON files
- **File**: `AGENTS.md:12` — says "Cobra CLI, YAML config, SQLite persistence, Docker API"
- **Code**: `internal/worker/persist.go` uses `encoding/json` with atomic file writes
- **Fix**: Change to "JSON file persistence" (SQLite is Phase 3)

### 2. [HIGH] go-conventions.md lists `modernc.org/sqlite` as dependency — not in go.mod
- **File**: `.claude/rules/go-conventions.md:20`
- **Code**: `go.mod` has 3 deps: cobra, yaml.v3, moby/moby. No sqlite.
- **Fix**: Remove sqlite from dependency list, note as Phase 3

### 3. [HIGH] worker-yaml-spec.md documents `network:` field — rejected by strict YAML parsing
- **File**: `.claude/rules/worker-yaml-spec.md:44`
- **Code**: `DockerConfig` struct has no `Network` field. `KnownFields(true)` rejects it.
- **Fix**: Remove `network: bridge` from YAML example

### 4. [HIGH] secrets.md shows `claude:` top-level YAML key — doesn't exist in Worker struct
- **File**: `.claude/rules/secrets.md:44-49`
- **Code**: Worker struct has Name, Endpoint, Docker, Timeout only.
- **Fix**: Update example to use `docker.token` field

### 5. [HIGH] Guide says "Claude — via Claude Agent SDK" — no SDK is used
- **File**: `docs/guide/index.md:26`
- **Code**: Workers are Docker containers with CLI tools inside
- **Fix**: Change to "Claude — via Docker containers running Claude Code CLI"

### 6. [HIGH] Pipeline described as working — only Worker noun is implemented
- **File**: `docs/guide/index.md:18-19`, `docs/index.md:20-21`
- **Code**: No Event, Task, or Policy packages exist
- **Fix**: Add "Current Status" note — Event/Task/Policy are designed, not implemented

## Medium Findings (fix soon)

| # | Finding | File |
|---|---------|------|
| 7 | `mecha serve` referenced but doesn't exist | `worker-yaml-spec.md:128` |
| 8 | `worker add` model validation described but not implemented | `worker-yaml-spec.md:129` |
| 9 | `busy` state defined but never assigned in Go code | `worker-design.md:30`, `types.go:10` |
| 10 | Worker type label: code returns "live", docs say "unmanaged" | `guide/index.md:32`, `config.go:40` |
| 11 | Result contract documented but no Go struct exists | `result-contract.md:10` |
| 12 | Redaction docs list `eyJ*` but code removed it (false positives) | `secrets.md:114` |
| 13 | Code redacts `gho_`, `ghu_`, `ghes_`, `glpat-` — not listed in docs | `secrets.md:106` |
| 14 | Credential mount feature documented but not implemented | `worker-yaml-spec.md:63` |
| 15 | Guide missing frontmatter (title, description) | `guide/index.md:1` |
| 16 | No CLI command reference anywhere in docs | all CLI commands |
| 17 | No Docker worker configuration guide | missing entirely |
| 18 | No secrets management documentation | missing entirely |

## Low Findings (nice to have)

- Pipeline notation in guide vs domain-model rule differ (simplified vs detailed)
- docs/index.md tagline doesn't match AGENTS.md tagline
- No code examples or YAML samples in guide
- 0 of 43 exported Go symbols have doc comments

## Fixing Plan

Priority-ordered:

1. **Fix AGENTS.md tech stack** — "JSON file persistence" not "SQLite persistence" (1 min)
2. **Fix go-conventions.md** — remove sqlite, note 3 current deps (1 min)
3. **Fix worker-yaml-spec.md** — remove `network:` field from YAML example (1 min)
4. **Fix secrets.md** — update example to use `docker.token`, sync redaction list with code (5 min)
5. **Fix guide/index.md** — correct worker descriptions, add current status note, add frontmatter (10 min)
6. **Add CLI reference page** — `docs/guide/cli.md` with all 9 commands + examples (30 min)
7. **Add Docker worker guide** — `docs/guide/workers.md` with YAML config reference (30 min)
8. **Add secrets guide** — `docs/guide/secrets.md` with setup instructions (20 min)
