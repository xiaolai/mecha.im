# 16 - Observability

End-to-end tests for traces, metrics, quality scoring, and alerts.

## Prerequisites

- At least one completed workflow run (from round 15)
- mecha v0.2.17+

## Traces

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 16.1 | List traces | `mecha trace list` | Shows recent traces across all workflows | P0 | |
| 16.2 | Filter by workflow | `mecha trace list test-pipeline` | Shows only traces for that workflow | P0 | |
| 16.3 | Show trace | `mecha trace show test-pipeline <run-id>` | Structured trace with per-step duration, cost, status | P0 | |
| 16.4 | Trace file inspectable | `cat ~/.mecha/observe/traces/test-pipeline/<run-id>.trace.json` | Valid JSON with traceId, steps array, totalCostUsd | P1 | |

## Metrics

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 16.5 | Bot metrics | `mecha metrics bot researcher` | Shows success rate, avg cost, avg duration | P0 | |
| 16.6 | Workflow metrics | `mecha metrics workflow test-pipeline` | Shows run count, success rate, avg cost | P0 | |
| 16.7 | No data | `mecha metrics bot nonexistent` | Shows "no data" message | P0 | |

## Quality Scoring

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 16.8 | Rate a run | `mecha workflow rate <run-id> 4` | Score recorded, confirmation message | P0 | |
| 16.9 | Rate validation | `mecha workflow rate <run-id> 6` | Error: score must be 1-5 | P0 | |
| 16.10 | Scores persist | Rate a run, then check `cat ~/.mecha/observe/scores/scores.jsonl` | JSONL entry with runId, score, source | P1 | |

## Alerts

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 16.11 | Add alert rule | `mecha alert add cost-high --metric cost_per_run --threshold 5 --comparison gt --message "Run cost exceeded $5"` | Rule created | P0 | |
| 16.12 | List rules | `mecha alert list --rules` | Shows the rule we just added | P0 | |
| 16.13 | Remove rule | `mecha alert remove cost-high` | Rule removed | P0 | |
| 16.14 | Alert history | `mecha alert list` after triggering an alert | Shows fired alerts with timestamp | P1 | |
