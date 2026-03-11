# Volume Mounts

All persistent data lives on the host at the bot's path (user-specified or `~/.mecha/bots/<name>/`). The container is disposable — rebuild the image, restart the container, everything survives.

## Host → Container Mapping

```
Host (bot path)                               Container              Mode
─────────────────────────────────────────     ──────────────────     ──────
<bot-path>/config.yaml                        /config/bot.yaml       ro
<bot-path>/sessions/                          /state/sessions/       rw
<bot-path>/data/                              /state/data/           rw
<bot-path>/costs.json                         /state/costs.json      rw
<bot-path>/logs/                              /state/logs/           rw
<bot-path>/tailscale/                         /state/tailscale/      rw
<bot-path>/claude/                            /home/appuser/.claude/ rw
<user-specified workspace>                    /workspace             ro (default) or rw
```

Where `<bot-path>` is resolved per `cli.md` Bot Path Resolution:
1. `--dir <path>` flag
2. Config file's parent directory
3. Fallback: `~/.mecha/bots/<name>/`

## What Each Volume Stores

### `/config/bot.yaml` (read-only)

Bot definition. Copied from user's YAML at spawn time. Container reads it on boot.

### `/state/sessions/` (read-write)

Per-task conversation history. See `sessions.md`.

```
sessions/
├── index.json
├── task-abc.jsonl
└── task-def.jsonl
```

### `/state/data/` (read-write)

Bot's scratch space. Downloaded files, generated artifacts, intermediate results. Persists across restarts.

### `/state/costs.json` (read-write)

Token usage and cost tracking. See `bot-status-api.md`.

**Important:** The CLI must pre-create this file before `docker run`. Use `--mount type=bind` (not `-v`) to prevent Docker from creating it as a directory if missing.

### `/state/logs/` (read-write)

Structured event history — `mecha_call` records, schedule run outcomes, webhook receipts. Written as JSONL. Used by the dashboard network map.

Operational logs (info, warnings, errors) go to stdout and are captured by Docker's log driver, accessible via `docker logs` / `mecha logs`.

### `/state/tailscale/` (read-write)

Tailscale daemon state. Preserves the bot's Tailscale identity (node key, IP) across container rebuilds. Without this, the bot would get a new IP on every restart.

### `/home/appuser/.claude/` (read-write)

Claude Code / Agent SDK state:
- Session history (Agent SDK's own format)
- Settings, preferences
- Any Claude-specific configuration

Mounting this means the Agent SDK can resume sessions natively.

### `/workspace` (read-only by default)

The user's codebase or project files. Mounted from the path specified in bot config:

```yaml
workspace: ./myproject          # mounted as /workspace:ro
```

Read-only by default. Can be made writable:

```yaml
workspace: ./myproject
workspace_writable: true        # mounted as /workspace:rw
```

Workspace path is resolved with `realpathSync()` before mounting to handle macOS symlinks (`/tmp` → `/private/tmp`).

## Full Docker Run (what `mecha spawn` generates)

```bash
docker run -d \
  --name mecha-reviewer \
  --hostname mecha-reviewer \
  --cap-add=NET_ADMIN \
  --device=/dev/net/tun \
  --mount type=bind,source=/Users/joker/bots/reviewer/config.yaml,target=/config/bot.yaml,readonly \
  --mount type=bind,source=/Users/joker/bots/reviewer/sessions,target=/state/sessions \
  --mount type=bind,source=/Users/joker/bots/reviewer/data,target=/state/data \
  --mount type=bind,source=/Users/joker/bots/reviewer/costs.json,target=/state/costs.json \
  --mount type=bind,source=/Users/joker/bots/reviewer/logs,target=/state/logs \
  --mount type=bind,source=/Users/joker/bots/reviewer/tailscale,target=/state/tailscale \
  --mount type=bind,source=/Users/joker/bots/reviewer/claude,target=/home/appuser/.claude \
  --mount type=bind,source=/Users/joker/myproject,target=/workspace,readonly \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e MECHA_BOT_NAME=reviewer \
  -e MECHA_TS_AUTH_KEY=tskey-auth-... \
  mecha-agent
```

Note: uses `--mount` instead of `-v` to prevent Docker from auto-creating missing paths as directories.

## Example Bot Directory

```
/Users/joker/bots/reviewer/        # user-specified path
├── config.yaml                     # bot definition
├── costs.json                      # token usage
├── sessions/                       # conversation history
├── data/                           # scratch space
├── logs/                           # structured event logs
├── tailscale/                      # tailscale identity
└── claude/                         # agent SDK state
```

## Global Directory

```
~/.mecha/
├── auth/
│   ├── anthropic-main.json
│   └── tailscale-main.json
├── registry.json                   # bot name → path mapping
└── mecha.json                      # global config
```

Bots may or may not live under `~/.mecha/bots/`. The registry tracks where each bot actually is.

## What Lives Only in the Container (ephemeral)

| What | Why ephemeral |
|------|---------------|
| Node.js runtime | Rebuilt with image |
| Agent SDK binary | Rebuilt with image |
| Tailscale binary | Rebuilt with image |
| s6-overlay | Rebuilt with image |
| npm packages | Rebuilt with image |
| `/tmp` | Scratch, not important |
| Bot dashboard SPA | Rebuilt with image |

## Rebuild Safety

```bash
# Rebuild the image (new SDK version, new agent code, etc.)
docker build -t mecha-agent .

# Restart a bot — all state preserved
mecha stop reviewer
mecha start reviewer
```

The container is cattle, the state is pets.
