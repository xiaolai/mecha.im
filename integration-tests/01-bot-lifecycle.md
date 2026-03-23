# 01 - Bot Lifecycle

Tests for bot spawn, start, stop, kill, restart, remove, and status.

## Prerequisites

- Mecha daemon running: `mecha start -d --host 0.0.0.0`
- Valid auth profile: `mecha auth ls`

## Tests

### Spawn

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 1.1 | Spawn bot with defaults | `mecha bot spawn test-bot ~/project` | Bot spawns, port 7700-7799 assigned, health check passes | P0 | |
| 1.2 | Spawn bot with explicit port | `mecha bot spawn test-bot2 ~/project --port 7710` | Bot runs on port 7710 | P0 | |
| 1.3 | Spawn bot with tags | `mecha bot spawn tagged ~/project --tags dev,research` | Tags persisted in config.json | P1 | |
| 1.4 | Spawn bot with expose | `mecha bot spawn exposed ~/project --expose query,read_workspace` | Capabilities persisted | P1 | |
| 1.5 | Spawn duplicate name | `mecha bot spawn test-bot ~/project` | Error: bot already exists (409) | P0 | |
| 1.6 | Spawn with invalid name | `mecha bot spawn "INVALID!" ~/project` | Error: invalid bot name | P0 | |
| 1.7 | Spawn with --no-auth | `mecha bot spawn no-auth-bot ~/project --no-auth` | Bot spawns without API credentials | P1 | |
| 1.8 | Spawn with model override | `mecha bot spawn model-bot ~/project --model claude-sonnet-4-5-20250514` | Model persisted in config | P1 | |
| 1.9a | Spawn with sandbox off | `mecha bot spawn sandbox-off ~/project --sandbox off` | sandboxMode: "off" in config | P1 | |
| 1.9b | Spawn with permission-mode | `mecha bot spawn perm-bot ~/project --permission-mode plan` | permissionMode: "plan" in config | P1 | |
| 1.9c | Spawn with orchestration expose | `mecha bot spawn orch-bot ~/project --expose query,bus_publish,workflow_run` | All 3 capabilities persisted | P1 | |

### Status & Listing

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 1.9 | List running bots | `mecha bot ls` | Shows all spawned bots with state, port, uptime | P0 | |
| 1.10 | Bot status | `mecha bot status test-bot` | Shows pid, port, state=running, uptime, memory | P0 | |
| 1.11 | Status of stopped bot | Stop bot, then `mecha bot status test-bot` | Shows state=stopped | P0 | |
| 1.12 | Status with --json | `mecha bot status test-bot --json` | Valid JSON output | P1 | |

### Stop & Kill

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 1.13 | Graceful stop | `mecha bot stop test-bot` | SIGTERM sent, process exits within 5s | P0 | |
| 1.14 | Force kill | `mecha bot kill test-bot` | SIGKILL sent, process exits immediately | P0 | |
| 1.15 | Stop already stopped | `mecha bot stop test-bot` (twice) | Error or no-op (not crash) | P0 | |
| 1.16 | Stop-all | Spawn 3 bots, `mecha bot stop-all` | All bots stopped | P0 | |
| 1.16a | Stop multiple names | `mecha bot stop bot-a bot-b` | Both stopped in one command | P1 | |

### Restart

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 1.17 | Restart running bot | `mecha bot restart test-bot` | New PID, same port, config preserved | P0 | |
| 1.18 | Restart stopped bot | `mecha bot restart test-bot` | Bot starts from persisted config | P1 | |
| 1.19 | Restart-all | `mecha bot restart-all` | All bots restarted with new PIDs | P1 | |

### Remove

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 1.20 | Remove stopped bot | `mecha bot remove test-bot` | Config, logs, sessions deleted from disk | P0 | |
| 1.21 | Remove running bot | `mecha bot remove test-bot --force` | Bot killed then removed | P0 | |
| 1.22 | Remove nonexistent | `mecha bot remove ghost` | Error: bot not found | P0 | |

### Configure

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 1.23 | Configure tags | `mecha bot configure test-bot --tags updated,v2` | Tags updated in config.json | P1 | |
| 1.24 | Configure expose | `mecha bot configure test-bot --expose query,execute` | Capabilities updated | P1 | |
| 1.25 | Configure auth | `mecha bot configure test-bot --auth default` | Auth profile switched | P1 | |

### Find

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 1.26 | Find bots (discovery) | `mecha bot find` | Lists all bots with discovery info | P1 | |

## Verification Queries

After each test, verify with:
```bash
mecha bot ls                     # List all bots
mecha bot status <name>          # Check specific bot
curl -s http://127.0.0.1:<port>/healthz  # Direct health check
ls ~/.mecha/<name>/              # Filesystem state
cat ~/.mecha/<name>/state.json   # Process state
cat ~/.mecha/<name>/config.json  # Bot config
```
