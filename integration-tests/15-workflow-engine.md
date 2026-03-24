# 15 - Workflow Engine

End-to-end tests for DAG workflow execution with gates, compensation, and dry-run.

## Prerequisites

- mecha v0.2.17+ on at least one machine
- At least 2 bots spawned (e.g., `researcher` and `writer`)
- Workflow YAML file at `~/.mecha/workflows/test-pipeline.yaml`

## Setup

Create a test workflow:
```bash
mkdir -p ~/.mecha/workflows
cat > ~/.mecha/workflows/test-pipeline.yaml << 'EOF'
{
  "name": "test-pipeline",
  "steps": {
    "research": {
      "bot": "researcher",
      "prompt": "List 3 facts about TypeScript",
      "output": "facts"
    },
    "summarize": {
      "bot": "writer",
      "prompt": "Summarize: {{research.facts}}",
      "depends": ["research"],
      "output": "summary"
    }
  }
}
EOF
```

## Workflow Lifecycle

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 15.1 | List workflows | `mecha workflow list` | Shows `test-pipeline` | P0 | PASS 2026-03-24 macbook-pro |
| 15.2 | Show workflow | `mecha workflow show test-pipeline` | Prints step DAG with bot assignments | P0 | PASS 2026-03-24 macbook-pro |
| 15.3 | Dry-run | `mecha workflow run test-pipeline --dry-run` | Executes with mock responses, shows [DRY RUN] prefix, $0.00 cost | P0 | PASS 2026-03-24 macbook-pro |
| 15.4 | Run workflow | `mecha workflow run test-pipeline` | Executes research → summarize, shows output and cost | P0 | DEFERRED — requires running bots |
| 15.5 | List runs | `mecha workflow runs test-pipeline` | Shows run history with status/date/cost | P0 | PASS 2026-03-24 macbook-pro |
| 15.6 | Run detail | `mecha workflow run-detail <run-id>` | Shows per-step status, duration, cost | P0 | PASS 2026-03-24 macbook-pro |

## Gates

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 15.7 | Gate pauses run | Create workflow with `gate: human` step, run it | Run pauses at gate step, status = "waiting" | P0 | DEFERRED — requires running bots |
| 15.8 | Approve gate | `mecha workflow approve <workflow> <run-id>` | Gated step executes, run continues | P0 | DEFERRED — requires running bots |
| 15.9 | Cancel run | `mecha workflow cancel <workflow> <run-id>` | Run status = "cancelled" | P0 | DEFERRED — requires running bots |

## Compensation

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 15.10 | Compensation on failure | Create workflow where step 2 fails, step 1 has `compensate` | Step 1's compensation runs in reverse, run status = "compensated" | P1 | DEFERRED — requires running bots |

## Workspace Locks

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 15.11 | Lock acquisition | Run workflow that locks a file during step execution | Lock file created, released after step | P1 | DEFERRED — requires running bots |

## Persistence

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 15.12 | Run state persists | Start a workflow, restart daemon, check run state | Run state preserved in JSON file | P0 | PASS 2026-03-24 macbook-pro |
| 15.13 | Definition snapshot | Modify workflow YAML during a run | In-progress run uses original definition (snapshot) | P1 | DEFERRED — requires running bots |

## New Features (v4.1.9)

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 15.14 | Workflow runs --last | Create 5+ runs, `mecha workflow runs test-pipeline --last 2` | Shows only 2 most recent runs | P0 | PASS 2026-03-24 macbook-pro |
| 15.15 | Dry-run with timeout step | Create workflow with `timeout: "10s"`, dry-run | Completes without timeout (dry-run is instant) | P1 | DEFERRED |
| 15.16 | Workflow YAML discovery | Create `test.yml` (not .yaml) in workflows dir, `mecha workflow list` | Shows test workflow | P0 | PASS 2026-03-24 macbook-pro |
