# Documentation Audit Report

**Project**: mecha.im
**Date**: 2026-03-30
**Language**: Go
**Framework**: VitePress

## Executive Summary

| Dimension | Score | Status |
|-----------|-------|--------|
| Freshness | 100/100 | 🟢 All docs current (0 days stale) |
| Accuracy  | 77/100 | 🟡 11 mismatches found |
| Coverage  | 98%    | 🟢 48/49 symbols documented |
| Quality   | 93/100 | 🟢 Production-quality docs |

**Overall health**: 82/100

## Critical Findings (fix immediately)

None.

## High Findings (fix soon)

### 1. Architecture diagram shows `claude --print` — code uses Agent SDK
- **Doc**: `docs/guide/architecture.md:27` — `Claude[claude --print]`
- **Code**: `docker/runtime/backends/claude.ts:1` — `import { query } from "@anthropic-ai/claude-agent-sdk"`
- **Fix**: Update Mermaid diagram + sequence diagram to show SDK query()

### 2. `CLAUDE_OUTPUT_FORMAT` documented but not implemented
- **Doc**: `docs/guide/workers.md:139` — lists it in Claude env var table
- **Code**: `claude.ts` never reads this env var; SDK controls format internally
- **Fix**: Remove from Claude env var table

### 3. `CODEX_EFFORT` env var not documented
- **Code**: `codex.ts:16` reads `CODEX_EFFORT`, passes as `-c model_reasoning_effort`
- **Doc**: `docs/guide/workers.md:144` — Codex table has only 3 rows, missing CODEX_EFFORT
- **Fix**: Add row to Codex table

### 4. `docker.host` field undocumented
- **Code**: `config.go:27` — `Host string` in DockerConfig, used by NewDockerClient
- **Doc**: `docs/guide/workers.md:49` — fields table has no `docker.host` row
- **Fix**: Add row to fields table

## Medium Findings (fix soon)

### 5. `worker remove` doc incomplete
- **Doc**: `cli.md:39` says "must be offline" — doesn't mention container is stopped first
- **Fix**: Clarify that remove stops+removes the container before registry deletion

### 6. Error state health not live-probed
- **Doc**: `cli.md:101` implies all workers probed concurrently
- **Fix**: Add note that error-state workers show stored message, not live probe

### 7. `looksLikeCredential` missing `ghu_` and `ghes_` prefixes
- **Doc**: `secrets.md:115` implies broad coverage with "etc."
- **Code**: Only checks 5 prefixes, not 7
- **Fix**: Add `ghu_`, `ghes_` to the function

### 8. `GEMINI_SANDBOX` values `docker`/`podman` are dead
- **Code**: `gemini.ts:9` only checks `=== "true"`, ignores other values
- **Doc**: `workers.md:155` lists `true`, `docker`, `podman`
- **Fix**: Remove `docker`/`podman` from doc table

## Low Findings (nice to have)

- `cli.md` heading hierarchy (H2-first, not H1→H2→H3)
- `secrets.md` has two H1 headings
- Architecture deps table shows only moby/client, not moby/api
- CLI example shows `v0.5.2` but latest tag is `v0.5.1`
- `looksLikeCredential` in helpers.go missing doc comment (1 symbol)

## Fixing Plan

1. Fix architecture.md diagrams — SDK instead of CLI wrapper (10 min)
2. Fix workers.md Claude table — remove CLAUDE_OUTPUT_FORMAT, add CODEX_EFFORT, add docker.host (5 min)
3. Fix helpers.go — add `ghu_`, `ghes_` to looksLikeCredential + doc comment (5 min)
4. Fix cli.md — clarify remove behavior, error state note (5 min)
5. Fix gemini.ts or workers.md — align GEMINI_SANDBOX values (5 min)
6. Fix heading hierarchy in cli.md and secrets.md (5 min)
