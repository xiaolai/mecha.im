# 07 - Metering & Budgets

Tests for cost tracking, budget enforcement, and meter daemon.

## Prerequisites

- Mecha daemon running (meter starts automatically)
- At least one bot with API activity

## Tests

### Meter Daemon

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 7.1 | Meter status | `mecha meter status` | Shows running, port (7600), PID | P0 | |
| 7.2 | Meter start (manual) | `mecha meter start` | Meter daemon starts on 7600 | P1 | |
| 7.3 | Meter stop | `mecha meter stop` | Meter daemon stops | P1 | |
| 7.4 | Meter already running | `mecha meter start` twice | Error: already running (409) | P1 | |

### Cost Tracking

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 7.5 | View all costs | `mecha cost` | Shows today's total cost across all bots | P0 | |
| 7.6 | View per-bot cost | `mecha cost coder` | Shows cost for specific bot | P0 | |
| 7.7 | Cost after chat | Chat with bot, then `mecha cost` | Cost increased from baseline | P0 | |
| 7.8 | Cost via API | `curl http://127.0.0.1:7660/meter/cost` (with auth) | JSON cost breakdown | P1 | |

### Budget Management

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 7.9 | Set daily budget | `mecha budget set coder --daily 5.00` | Budget saved | P0 | |
| 7.10 | Set monthly budget | `mecha budget set --global --monthly 100.00` | Global budget saved | P1 | |
| 7.11 | List budgets | `mecha budget ls` | Shows all budget rules | P0 | |
| 7.12 | Remove budget | `mecha budget rm coder --daily` | Budget removed | P1 | |
| 7.13 | Budget enforcement | Set $0.01 daily, chat with bot | Request blocked (402 or error) | P0 | |
| 7.14 | Tag-based budget | `mecha budget set --tag dev --daily 10.00` | Budget applies to all dev-tagged bots | P2 | |

## Verification

```bash
# Meter data directory
ls ~/.mecha/meter/

# Budget config
cat ~/.mecha/meter/budgets.json

# Event logs (per-day)
ls ~/.mecha/meter/events/

# Hot counters (in-memory snapshot)
cat ~/.mecha/meter/hot/snapshot.json

# Cost rollups
ls ~/.mecha/meter/rollups/
```
