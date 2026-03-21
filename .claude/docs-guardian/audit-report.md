# Documentation Audit Report (Post-Fix)

**Project**: mecha.im
**Date**: 2026-03-21
**Language**: TypeScript
**Framework**: VitePress
**Version**: v4.0.0

## Executive Summary

| Dimension | Score | Status |
|-----------|-------|--------|
| Freshness | 100/100 | Pass |
| Accuracy  | 86/100 | Good |
| Coverage  | 99%    | Good |
| Quality   | 98/100 | Good |

**Overall health**: 93/100 (up from 72)

## Remaining Findings

### [HIGH] agent.md lists X-Mecha-Source as part of "all three or none" signature headers — it's independent

Code checks only 3 headers: timestamp, nonce, signature. Source is read separately with "admin" default.

### [MEDIUM] Workflow snapshot file has .yaml extension but contains JSON

`engine.ts:227` writes JSON to a `.yaml` file. Docs say "snapshotted definition" implying YAML.

### [MEDIUM] `GET /bots` route used by `node health` but not documented in agent.md

`node-health.ts:56` fetches `/bots` endpoint. Agent.md only lists `/healthz` and `/bots/:name/query`.

### [LOW] agent.md says port default is 7660 but the field is required with no code-level default

### [MEDIUM] @mecha/service has 55 of 70 exports with table-only docs (no prose/signatures)

### [MEDIUM] Type shapes for bus, workflow, observe, teams packages lack field-level definitions

## Fixing Plan

1. Fix agent.md signature headers section
2. Fix agent.md port description
3. Note snapshot .yaml/JSON discrepancy in workflow docs
4. Service/bus/workflow/observe/teams detailed docs — future backfill pass
