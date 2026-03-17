# CLI-First Design — Industrial-Grade Mecha CLI

## Summary

Systematically bring the mecha CLI to industrial quality across 3 phases. Each phase is independently shippable and builds on the previous.

## Current State

The CLI (`src/cli.ts`, ~330 lines) uses Commander.js. It has 15 commands but is missing 7 features the dashboard has. Error messages lack fix hints. No `--json` output. No color. No shell completions. Documentation references `mecha chat` but the command is `mecha query`.

---

## Phase 1: Fix Broken Basics

Ship on `feat/cli-first-or-preferred` branch. All changes to `src/cli.ts` and docs.

### 1.1 Add `mecha restart <name>`

`docker.restart()` exists but has no CLI command. Add it mirroring `start`/`stop` pattern. Include `--force` flag to skip busy check (same as dashboard's force-restart).

### 1.2 Add `--force` to `mecha rm`

Currently `rm` fails silently if container doesn't exist or is running. With `--force`: stop container first if running, suppress "not found" errors, always clean up registry entry. Without `--force`: fail if running (suggest `--force` in error message).

### 1.3 Enrich `mecha ls`

Current output: NAME, STATUS, PORT, MODEL. Add:
- **UPTIME** — from Docker container state (`startedAt`)
- **COST** — today's spend from `costs.json` in bot state dir
- **`--json`** flag — output as JSON array for scripting
- **`--quiet`/`-q`** flag — output only bot names (for piping: `mecha ls -q | xargs -I{} mecha stop {}`)

### 1.4 Improve Error Messages

Pattern: **What happened - Why - How to fix**

| Error | Current | Improved |
|-------|---------|----------|
| Bot not found | `Bot "X" not found` | `Bot "X" not found. Run "mecha ls" to see available bots.` |
| Bot busy (409) | Exit with error | `Bot "X" is busy. Use --force to override, or wait.` |
| Spawn port conflict | Generic error | `Port 3001 already in use. Try --expose 3002 or omit --expose for auto-assign.` |
| Auth missing | Already good | Keep |
| Config invalid | YAML parse error | `Config error in reviewer.yaml: missing "system" field. See "mecha spawn --help".` |

### 1.5 Fix Documentation

- README.md: change all `mecha chat` to `mecha query`
- `website/docs/reference/cli.md`: fix command name, document all `query` flags (`--max-turns`, `--effort`, `--budget`, `--resume`, `--model`)
- `website/docs/guide/quickstart.md`: fix if affected

### 1.6 Add `mecha exec <name> <command...>`

Essential debugging tool. Runs a command inside the bot's container as `appuser`. Uses `dockerode` container.exec API with execFile semantics (no shell injection). Streams stdout/stderr. `--interactive`/`-it` attaches stdin for shell sessions.

---

## Phase 2: CLI-Dashboard Parity

Separate branch. Brings CLI to feature parity with the dashboard.

### 2.1 `mecha config <name>`

View bot configuration:

```
mecha config worker              # pretty-print bot.yaml
mecha config worker --json       # JSON output
mecha config worker --field model # single field
```

Edit (requires restart):

```
mecha config worker --set model=opus
mecha config worker --set max_turns=50
```

### 2.2 `mecha sessions <name>`

Browse Claude Code conversation history:

```
mecha sessions worker                        # list recent sessions
mecha sessions worker --json                 # JSON output
mecha sessions worker <session-id>           # show session detail
mecha sessions worker <session-id> --log     # show full conversation
mecha sessions worker --search "database"    # search across sessions
```

Reads from `.claude/projects/` inside the container via dockerode exec.

### 2.3 `mecha costs [name]`

Cost tracking from CLI:

```
mecha costs                    # today's total across all bots
mecha costs worker             # per-bot breakdown
mecha costs --period week      # last 7 days
mecha costs --json             # JSON output
```

Reads from `costs.json` in each bot's state dir.

### 2.4 `mecha schedule <name>`

Manage schedules from CLI:

```
mecha schedule worker ls                              # list schedules
mecha schedule worker add "0 */6 * * *" "Check PRs"   # add cron schedule
mecha schedule worker rm <schedule-id>                 # remove
mecha schedule worker pause <schedule-id>              # pause
mecha schedule worker run <schedule-id>                # trigger now
mecha schedule worker history                          # recent runs
```

Proxies to bot's `/api/schedule` endpoints.

### 2.5 `mecha webhooks <name>`

Manage webhooks from CLI:

```
mecha webhooks worker ls              # list webhook configs
mecha webhooks worker add <event>     # add event filter
mecha webhooks worker rm <event>      # remove event filter
```

### 2.6 Batch Operations

```
mecha stop --all                # stop all running bots (with confirmation)
mecha restart --all             # restart all
mecha ls --status running       # filter by status
mecha ls --model opus           # filter by model
```

---

## Phase 3: Industrial Polish

Separate branch. The UX layer that makes the CLI feel professional.

### 3.1 Color Output

Use `picocolors` (already in deps via vite). Follow conventions:
- Green: success, running state
- Yellow: warnings, busy/scheduled state
- Red: errors, stopped/error state
- Cyan: bot names, identifiers
- Dim: metadata, timestamps
- Respect `NO_COLOR` env var and `--no-color` flag

### 3.2 Spinners for Long Operations

Use `ora` for operations >200ms: `spawn`, `restart`, `rm`, `init`.

### 3.3 Shell Completions

```
mecha completion bash > /etc/bash_completion.d/mecha
mecha completion zsh > ~/.zsh/completions/_mecha
eval "$(mecha completion bash)"
```

Dynamic completions for bot names: `mecha stop <TAB>` lists running bots.

### 3.4 `mecha watch`

Live fleet dashboard in the terminal. Refreshes every 5s:

```
Every 5s - 3 bots running, $2.34 today

NAME      STATE    MODEL    UPTIME   COST     ACTIVITY
worker    running  opus     2h 34m   $0.42    idle
analyst   busy     sonnet   1d 3h    $1.87    thinking (12s)
helper    stopped  haiku    -        $0.03    -

[q] quit  [r] refresh
```

### 3.5 Improved First-Run Experience

`mecha init` becomes guided with prerequisite checks and next-step suggestions.

### 3.6 `mecha version` Enhancement

Show all installed tool versions (mecha, claude-code, codex, gemini-cli, node, docker).

### 3.7 Suggest Next Command

After operations, suggest the logical next step.

---

## Phase Dependency

```
Phase 1 (broken basics) - this branch
  |
  v
Phase 2 (parity) - depends on Phase 1 patterns
  |
  v
Phase 3 (polish) - depends on Phase 2 commands existing
```

Each phase is independently shippable.

## Files to Modify

### Phase 1
| File | Change |
|------|--------|
| `src/cli.ts` | Add restart, add exec, --force on rm, --json/--quiet on ls |
| `src/docker.ts` | Add `execInContainer()` function |
| `src/cli-utils.ts` | Add formatUptime, formatCost helpers |
| `shared/errors.ts` | Add `hint` field to MechaError |
| `README.md` | Fix chat to query |
| `website/docs/reference/cli.md` | Fix chat to query, document query flags |
| `website/docs/guide/quickstart.md` | Fix if affected |

### Phase 2
| File | Change |
|------|--------|
| `src/cli.ts` | Add config, sessions, costs, schedule, webhooks commands |
| `src/commands/config.ts` | New: config view/edit |
| `src/commands/sessions.ts` | New: session browser |
| `src/commands/costs.ts` | New: cost queries |
| `src/commands/schedule.ts` | New: schedule management |
| `src/commands/webhooks.ts` | New: webhook management |

### Phase 3
| File | Change |
|------|--------|
| `src/cli-utils.ts` | Color output, spinners |
| `src/cli.ts` | watch, completion, version commands |
| `src/commands/watch.ts` | New: live terminal dashboard |
| `src/commands/completion.ts` | New: shell completion generator |
