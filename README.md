# Mecha

An army of agents. Run autonomous Claude bots in Docker containers with scheduling, webhooks, and bot-to-bot communication over Tailscale.

## Quickstart

```bash
# Install
npm install -g @mecha.im/cli
# Or run without installing: npx @mecha.im/cli

# Initialize (builds Docker image)
mecha init

# Set your API key
export ANTHROPIC_API_KEY=sk-ant-...
# Or use a profile:
mecha auth add anthropic-main sk-ant-...

# Spawn a bot inline
mecha spawn --name greeter --system "You greet people warmly."

# Chat with it
mecha query greeter "Hello!"

# List bots
mecha ls

# Stop / restart / remove
mecha stop greeter
mecha start greeter
mecha rm greeter
```

## Config File

```yaml
name: reviewer
system: |
  You are a code reviewer. You review PRs for bugs,
  security issues, and style violations.
model: sonnet
auth: anthropic-main
max_turns: 25
max_budget_usd: 1.00

schedule:
  - cron: "*/30 * * * *"
    prompt: "Check for new unreviewed PRs."

webhooks:
  accept:
    - "pull_request.opened"
    - "pull_request.synchronize"

workspace: ./myproject
expose: 8080
```

```bash
mecha spawn reviewer.yaml
```

## Commands

| Command | Description |
|---------|-------------|
| `mecha init [--headscale]` | Initialize mecha, build Docker image |
| `mecha spawn <config> [--dir] [--expose]` | Spawn bot from config file |
| `mecha spawn --name X --system "..." [--model M]` | Spawn bot inline |
| `mecha start <name>` | Start a stopped bot |
| `mecha stop <name>` | Stop a running bot |
| `mecha rm <name>` | Remove a bot |
| `mecha ls` | List all bots |
| `mecha query <name> "prompt"` | Send a one-shot prompt to a bot |
| `mecha restart <name>` | Restart a running bot |
| `mecha exec <name> [cmd...]` | Run a command inside a bot's container |
| `mecha logs <name> [-f]` | Show bot logs |
| `mecha auth add <profile> <key>` | Add auth profile |
| `mecha auth list` | List auth profiles |
| `mecha auth swap <bot> <profile>` | Swap auth for a bot |
| `mecha token` | Generate a bot token |
| `mecha dashboard [--port N]` | Start fleet dashboard |

## Architecture

```
Host (CLI)                    Container (Agent)
─────────────────────────     ──────────────────────────
src/cli.ts                    agent/entry.ts
src/docker.ts (dockerode)     agent/server.ts (Hono)
src/store.ts (~/.mecha/)      agent/session.ts
src/config.ts                 agent/scheduler.ts (croner)
src/auth.ts                   agent/webhook.ts
src/dashboard-server.ts       agent/costs.ts
                              agent/activity.ts
                              agent/tools/mecha-server.ts
                              agent/tools/mecha-call.ts
                              agent/tools/mecha-list.ts
```

## Bot-to-Bot Communication

Bots discover each other via Tailscale/Headscale and communicate using built-in MCP tools:

- `mecha_call` — send a prompt to another bot
- `mecha_list` — discover available bots on the network
- `mecha_new_session` — start a fresh conversation

## Scheduling

Bots run prompts on cron schedules with safety rails:
- Max 50 runs per day
- 10 minute timeout per run
- Auto-pause after 5 consecutive errors
- Skip if busy

## Dashboard

```bash
mecha dashboard
# Opens http://localhost:7700
```

Fleet dashboard shows all bots with status, costs, and a communication map. Click a bot to access its individual dashboard with chat, tasks, schedule, logs, and config views.

The dashboard now uses a local browser session on `localhost` so the SPA and proxied bot dashboards work without manually copying bearer tokens into browser requests.

## Auth

Auth works via environment variable or named profiles:

```bash
# Environment variable (simplest)
export ANTHROPIC_API_KEY=sk-ant-...

# Named profile
mecha auth add anthropic-main sk-ant-...
mecha auth add tailscale-main tskey-auth-...
```

Profiles are stored at `~/.mecha/auth/<name>.json`.

## Container Runtime Notes

- Workspace-mounted bots load project settings (`.claude/settings.json`, `CLAUDE.md`, skills) from the mounted workspace.
- Bots without a mounted workspace run from a stable state-backed working directory and only load user settings.
- Host Codex auth is not copied into containers by default. Opt in with `MECHA_COPY_HOST_CODEX_AUTH=1` if you explicitly want that behavior.

## Testing

```bash
# Fast local tests
npm test

# Docker-dependent suites
npm run test:docker

# Live SDK/API suite (costs money)
npm run test:live
```

## Credits

The pixel office engine uses artwork and inspiration from:

- [MetroCity Free TopDown Character Pack](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack) by Jik-A-4 — character sprites
- [pixel-agents](https://github.com/pablodelucca/pixel-agents) by Pablo De Lucca — architecture & inspiration

## Requirements

- Node.js 22+
- Docker (Colima, Docker Desktop, or any OCI runtime)
- Tailscale (optional, for multi-machine mesh)
