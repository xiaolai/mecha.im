# Rounds 15-19 — Orchestration Layer Findings

**Version**: 4.1.4
**Date**: 2026-03-23
**Machine(s)**: mac-mini-home (100.100.1.7)

## Round 15 — Workflow Engine

| # | Test | Result |
|---|------|--------|
| 15.1 | List workflows | PASS |
| 15.2 | Show workflow | PASS (shows step DAG) |
| 15.4 | Run workflow | PASS (research→summarize, $0.0246) |
| 15.5 | List runs | PASS |
| 15.6 | Run detail | PASS |
| 15.3 | Dry-run | DEFERRED |
| 15.7-15.13 | Gates, compensation, locks, persistence | DEFERRED |

## Round 16 — Observability

| # | Test | Result |
|---|------|--------|
| 16.1 | trace list | PASS |
| 16.2 | metrics bot | PASS (shows success rate, avg cost, duration) |
| 16.3 | alert add | PASS (requires --comparison and --message flags) |
| 16.4 | alert list | PASS |
| 16.5 | alert remove | PASS |

**Finding**: `alert add` requires `--comparison <op>` and `--message <msg>` — test doc only showed `--metric` and `--threshold`.

## Round 17 — Teams

| # | Test | Result |
|---|------|--------|
| 17.1 | team deploy | PASS (team YAML requires `cwd` not `workspace`) |
| 17.2 | team list | PASS |
| 17.3 | team status | PASS |
| 17.4 | team teardown | PASS |

**Finding**: Team YAML uses `cwd` field, not `workspace`. No `--meter` flag on `team deploy`.

## Round 18 — Gateway & Secrets

| # | Test | Result |
|---|------|--------|
| 18.1 | secret set | PASS |
| 18.2 | secret list | PASS |
| 18.3 | secret grant | PASS |
| 18.4 | secret revoke | PASS |

## Round 19 — Meta-Agent

| # | Test | Result |
|---|------|--------|
| 19.1 | meta status | PASS ("not running" — expected) |
| 19.2 | meta report | PASS (shows workflow runs, costs) |
