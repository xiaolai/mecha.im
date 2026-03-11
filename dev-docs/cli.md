# CLI Commands

## Overview

11 commands. The CLI is a thin Docker orchestrator — it does not run agent logic.

## Bot Path Resolution

Bots can live anywhere on disk. Resolution order:

1. `--dir <path>` flag → use that directory for bot state
2. Config file's parent directory (e.g. `./bots/reviewer/config.yaml` → `./bots/reviewer/`)
3. Fallback: `~/.mecha/bots/<name>/`

All bot paths are stored in `~/.mecha/registry.json`:

```json
{
  "reviewer": "/Users/joker/projects/bots/reviewer",
  "researcher": "/home/joker/.mecha/bots/researcher"
}
```

All commands look up bot path from the registry by name.

## Commands

### `mecha init`

First-time setup. Builds the Docker image, creates `~/.mecha/` directory structure.

```bash
mecha init                    # basic setup
mecha init --headscale        # also starts a local Headscale container
```

### `mecha spawn <config.yaml> [--dir <path>] [--expose N]`

Create and start a new bot container.

```bash
mecha spawn reviewer.yaml
mecha spawn reviewer.yaml --dir ~/my-bots/reviewer
mecha spawn reviewer.yaml --expose 8080
```

Or inline:

```bash
mecha spawn --name researcher --system "You are a researcher." --model sonnet
```

What it does:
1. Validates config (zod)
2. Resolves bot path (--dir > config parent dir > ~/.mecha/bots/<name>/)
3. Copies config, creates `sessions/`, `data/`, `tailscale/`, `claude/`, `logs/` directories
4. Pre-creates `costs.json` (prevents Docker directory mount bug)
5. Resolves auth profile → injects as env var
6. Resolves workspace path (realpathSync for symlinks)
7. `docker run -d` with `--mount` binds, env vars, labels, Tailscale auth
8. Waits for health check (exponential backoff, 30s timeout)
9. Registers bot path in `~/.mecha/registry.json`

### `mecha start <name>`

Restart a stopped bot. Reads saved config from the bot's directory.

```bash
mecha start reviewer
```

Different from `spawn`: `spawn` creates new, `start` restarts existing.

### `mecha stop <name>`

Stop a bot. Keeps state for later restart.

```bash
mecha stop reviewer
```

### `mecha rm <name>`

Remove a bot — stops container, deletes state.

```bash
mecha rm reviewer
```

Asks for confirmation if sessions exist.

### `mecha ls`

List all bots across all nodes on the tailnet.

```bash
mecha ls
```

Output:

```
NAME         NODE      STATUS    IP           MODEL    SCHEDULE
reviewer     laptop    running   100.64.0.1   sonnet   2 jobs
researcher   server    running   100.64.0.3   sonnet   —
monitor      server    running   100.64.0.4   haiku    1 job
writer       laptop    stopped   —            sonnet   —
```

Queries Headscale/Tailscale API for all nodes tagged `tag:mecha-bot`. Also detects orphaned containers and stale registry entries.

### `mecha chat <name> "prompt"`

Send a prompt to a running bot, stream response to terminal.

```bash
mecha chat reviewer "Review the latest commit on main"
```

Streams SSE from the container's `/prompt` endpoint to stdout. If bot is busy, shows current task and waits or exits.

### `mecha logs <name> [-f]`

Tail container logs.

```bash
mecha logs reviewer
mecha logs reviewer -f
```

### `mecha auth add <profile> <key>`

Store an auth profile.

```bash
mecha auth add anthropic-main sk-ant-...
mecha auth add tailscale-main tskey-auth-...
```

### `mecha auth swap <bot> <profile>`

Switch a bot's auth. Restarts the container.

```bash
mecha auth swap reviewer anthropic-backup
```

### `mecha dashboard [--port N]`

Start the fleet dashboard and open in browser.

```bash
mecha dashboard
mecha dashboard --port 7700
```
