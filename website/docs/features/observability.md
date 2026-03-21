---
title: Observability
description: Structured traces, metrics, quality scoring, and alerts for workflow runs and bot performance
---

# Observability

The observability package provides structured traces, metrics aggregation, quality scoring, and threshold-based alerts for workflow runs and bot performance.

## Core Concepts

### Traces

Every workflow run produces a structured trace linking the run to its steps, with per-step duration, cost, tool usage, and quality scores.

```json
{
  "traceId": "run-2026-03-21-001",
  "workflow": "content-pipeline",
  "totalCostUsd": 2.47,
  "steps": [
    { "stepId": "research", "bot": "researcher", "duration": "120.0s", "costUsd": 0.50 },
    { "stepId": "draft", "bot": "writer", "duration": "180.0s", "costUsd": 1.50 }
  ]
}
```

### Quality Scoring

Three sources of quality signal:

| Source | How it works |
|--------|-------------|
| **Human** | `mecha workflow rate <run-id> 4` (1-5 scale) |
| **Automated** | A reviewer bot evaluates output against criteria |
| **Implicit** | Gate approved without revision = high quality; step repeated = low quality |

### Metrics

Aggregated per-bot and per-workflow metrics computed from traces:

- Success rate, average cost, average duration
- Quality score trends, revision rate
- Queue depth and wait time

### Alerts

Rule-based threshold alerts that fire when metrics cross boundaries:

```json
{ "id": "cost-high", "metric": "cost_per_run", "threshold": 5.0, "comparison": "gt", "message": "Run cost exceeded $5" }
```

## Data Model

All observability data is stored as JSON files — no database required.

```
~/.mecha/observe/
├── traces/
│   └── content-pipeline/
│       └── run-001.trace.json
├── scores/
│   └── scores.jsonl              # append-only quality scores
└── alerts/
    ├── rules.json                # alert rule definitions
    └── alerts.jsonl              # fired alert history
```

## CLI Usage

```bash
# Rate a workflow run (1-5 scale)
mecha workflow rate run-2026-03-21-b2d92950 4
# Recorded score 4/5 for run run-2026-03-21-b2d92950

# View bot performance metrics
mecha metrics bot researcher --days 7
# Shows success rate, avg cost, avg duration

# View workflow metrics
mecha metrics workflow test-pipeline

# Add an alert rule
mecha alert add cost-high --metric cost_per_run --threshold 5 --comparison gt --message "Run cost exceeded $5"
# Alert rule "cost-high" added

# List alert rules
mecha alert list --rules
# ID         Metric        Comparison  Threshold  Message
# ---------  ------------  ----------  ---------  ---------------------------
# cost-high  cost_per_run  gt          5          Run cost exceeded $5

# View fired alerts
mecha alert list

# Remove an alert rule
mecha alert remove cost-high

# Tuning recommendations
mecha meta tune researcher
# Analyzes quality score trends, suggests prompt changes

# Company report
mecha meta report --days 7
# Company Report (last 7 days)
# ────────────────────────────────────────
# test-pipeline:
#   Runs: 3  Success: 100%  Avg cost: $0.02
# Total: 3 runs, $0.06 spent
```

## Package

`@mecha/observe` — `packages/observe/src/`

| Export | Description |
|--------|-------------|
| `createTraceStore(dir)` | File-backed trace storage |
| `buildTrace(opts)` | Build a trace from workflow run state |
| `createScoreStore(dir)` | Quality score storage with per-bot/per-run queries |
| `computeMetrics(traces, opts)` | Aggregate metrics by bot or workflow |
| `createAlertEngine(dir)` | Rule-based alert evaluation with history |
| `analyzeBotPerformance(store, bot)` | Trend detection for prompt tuning |
| `suggestPromptChange(analysis)` | Generate prompt improvement suggestions from analysis |
| `createExperiment(opts)` | Define A/B test experiments |
| `runExperiment(experiment, executor)` | Execute experiment variants |
| `compareResults(...)` | A/B test comparison |
