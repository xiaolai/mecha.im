# Documentation Audit Report

**Project**: mecha.im
**Date**: 2026-03-24
**Language**: TypeScript
**Framework**: VitePress

## Executive Summary

| Dimension | Score | Status |
|-----------|-------|--------|
| Freshness | 100/100 | GREEN |
| Accuracy  | 90/100 | YELLOW |
| Coverage  | 81%    | YELLOW |
| Quality   | 74/100 | YELLOW |

**Overall health**: 86/100

## Critical Findings (fix immediately)

1. **TeamDef type missing `bus`, `workflows`, `schedules` fields** — teams.md:110
2. **DeployResult/DeployOpts missing new fields** — teams.md:159-192
3. **StepDef.maxRetries missing from workflow docs** — workflow.md:157
4. **RunState.outputs missing from workflow docs** — workflow.md:236
5. **DeployedTeam missing bus/workflows/schedules** — teams.md:170

## High Findings (fix soon)

6. Bus MCP tools list missing bus_queue_nack and bus_poll — bus.md:126
7. BusMessage.notBefore and QueueConfig.claimTimeoutMs missing — bus.md:130-149
8. QualityScore.workflow field missing — observability.md:160
9. Workflow exports missing assertNoCycles, validateOutput — workflow.md:443
10. Bus exports missing readJsonl, writeJsonl, appendJsonl, withFileLock — bus.md:313
11. ~40 symbols in packages/core undocumented externally

## Medium Findings

12. 127 code blocks without language tags in core.md
13. 19 code blocks without language tags in runtime.md
14. Missing [[toc]] directive in 4 feature docs
15. Heading hierarchy skips in bus.md and workflow.md
16. avgForWorkflow description incomplete in observability.md

## Fixing Plan

1. Update teams.md type tables (30 min)
2. Update workflow.md type tables + exports (20 min)
3. Update bus.md MCP tools + type tables + exports (20 min)
4. Update observability.md QualityScore + avgForWorkflow (10 min)
5. Add language tags to core.md and runtime.md code blocks (30 min)
6. Add [[toc]] directives to 4 feature docs (10 min)
7. Fix heading hierarchy in bus.md and workflow.md (10 min)
8. Document core package gaps — errors, task storage, TOTP, server state (2 hours)
