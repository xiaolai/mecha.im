# 04 - Scheduling

Tests for periodic schedule management and execution.

## Prerequisites

- Bot running: `mecha bot spawn worker ~/project`
- Valid API key for actual schedule execution

## Tests

### Schedule CRUD (CLI)

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 4.1 | Add schedule | `mecha schedule add worker --id daily-check --every 5m --prompt "Check system health"` | Schedule created, listed | P0 | |
| 4.2 | List schedules | `mecha schedule list worker` | Shows schedule with id, interval, prompt, paused state | P0 | |
| 4.3 | Add duplicate | `mecha schedule add worker --id daily-check --every 10m --prompt "dup"` | Error: schedule already exists (409) | P0 | |
| 4.4 | Add invalid interval | `mecha schedule add worker --id bad --every 2s --prompt "too fast"` | Error: invalid interval (minimum 1m) | P0 | |
| 4.5 | Remove schedule | `mecha schedule remove worker daily-check` | Schedule removed, no longer listed | P0 | |
| 4.6 | Remove nonexistent | `mecha schedule remove worker ghost` | Error: not found (404) | P1 | |

### Schedule Control (CLI)

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 4.7 | Pause schedule | `mecha schedule pause worker daily-check` | Schedule paused, shows paused=true | P0 | |
| 4.8 | Resume schedule | `mecha schedule resume worker daily-check` | Schedule resumed, shows paused=false | P0 | |
| 4.9 | Pause all | Add 2 schedules, `mecha schedule pause worker` (no id) | All schedules paused | P1 | |
| 4.10 | Resume all | `mecha schedule resume worker` (no id) | All schedules resumed | P1 | |
| 4.11 | Pause nonexistent | `mecha schedule pause worker ghost` | Error: not found (404) | P1 | |

### Schedule Execution

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 4.12 | Manual trigger | `mecha schedule run worker daily-check` | Runs immediately, returns outcome + durationMs | P0 | |
| 4.13 | Run nonexistent | `mecha schedule run worker ghost` | Error: not found (404) | P1 | |
| 4.14 | View history | `mecha schedule history worker daily-check` | Shows run records with timestamp, outcome, duration | P0 | |
| 4.15 | History with limit | `mecha schedule history worker daily-check --limit 2` | At most 2 entries | P1 | |

### Schedule HTTP API

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 4.16 | POST /api/schedules | Direct HTTP to bot port | 201 with schedule data | P1 | |
| 4.17 | POST /api/schedules/:id/run | Direct HTTP trigger | 200 with execution result | P1 | |
| 4.18 | GET /api/schedules/:id/history | Direct HTTP | Run history array | P1 | |

### Cron Expressions (v4.1.9)

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 4.19 | Cron expression schedule | `mecha schedule add bot --id cron-test --every "0 */6 * * *" --prompt "check"` | Schedule created with cron expression | P1 | FAIL 2026-03-24 macbook-pro — schedule add uses parseInterval (interval only), not parseScheduleExpression |

## Verification

```bash
# Schedule config persisted on disk
ls ~/.mecha/<bot>/schedules/

# Schedule state in runtime
curl http://127.0.0.1:<port>/api/schedules -H "Authorization: Bearer <token>"

# After restart, schedules should reload
mecha bot restart worker
mecha schedule list worker    # Should still show schedules
```
