# Tech Stack

## Decisions

| Component | Choice | Why |
|-----------|--------|-----|
| Language | TypeScript | Matches Agent SDK, single language for host + container |
| CLI framework | commander | Proven, small, no magic |
| Docker runtime | Colima (or any Docker-compatible) | Free, lightweight, no Docker Desktop license |
| Docker client | dockerode | Programmatic Docker control, no shell-out |
| Container HTTP | Hono | Tiny (~14KB), fast, good DX |
| Mesh networking | Tailscale / Headscale | Encrypted bot-to-bot, multi-machine, MagicDNS |
| Cron (in container) | croner | Lightweight, zero-dep, cron + human syntax |
| Config validation | zod | Standard, good errors |
| Session storage | flat files (JSONL) | Simple, inspectable, volume-mountable |
| Streaming | SSE on /prompt | Simpler than WebSocket for request-response |
| Agent SDK | @anthropic-ai/claude-agent-sdk | Programmatic API (`query()`) — our app imports this |
| Claude Code CLI | @anthropic-ai/claude-code | CLI binary — SDK spawns it as child process |

## Project Structure

```
mecha/
├── src/                          # HOST CLI
│   ├── cli.ts                    # entry point, commander program
│   ├── docker.ts                 # dockerode: spawn, stop, ls, logs
│   ├── config.ts                 # load + validate bot yaml
│   ├── store.ts                  # ~/.mecha/ directory management
│   └── auth.ts                   # auth profile CRUD
├── agent/                        # CONTAINER
│   ├── entry.ts                  # main: load config, start server + scheduler
│   ├── server.ts                 # Hono: /prompt, /health, /webhook
│   ├── scheduler.ts              # croner, fires prompts to self
│   ├── session.ts                # per-task session read/write
│   ├── webhook.ts                # allowlist filter
│   └── tools/
│       ├── mecha-server.ts       # createSdkMcpServer() — registers all custom tools
│       ├── mecha-call.ts         # call another bot (tool handler)
│       ├── mecha-list.ts         # discover bots (tool handler)
│       └── mecha-new-session.ts  # start new task/session (tool handler)
├── Dockerfile                    # multi-stage: build + minimal runtime
├── package.json
└── tsconfig.json
```

## Docker Runtime

Use Colima (or any Docker-compatible runtime) instead of Docker Desktop:

```bash
brew install colima docker
colima start
# all docker commands work as normal
```

Any OCI-compatible runtime works. The CLI uses dockerode which talks to the Docker socket.

## Dockerfile Strategy

Two packages are needed inside the container:

| Package | Role | Install method |
|---------|------|---------------|
| `@anthropic-ai/claude-code` | CLI binary (`claude`) — spawned by SDK as child process | `npm install -g` (official hosting docs recommend this for containers) |
| `@anthropic-ai/claude-agent-sdk` | Programmatic SDK (`query()` API) — our app imports this | Project dependency via `npm ci` |

> **Note:** For end-user desktop installs, Anthropic now recommends `curl -fsSL https://claude.ai/install.sh | bash` instead of npm. But for Docker containers, `npm install -g @anthropic-ai/claude-code` remains the documented approach (see [hosting docs](https://platform.claude.com/docs/en/agent-sdk/hosting)).

Multi-stage build:

```dockerfile
# Stage 1: Build
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY shared/ shared/
COPY agent/ agent/
RUN npx tsc -p tsconfig.agent.json

# Stage 2: Runtime
FROM node:22-alpine
RUN adduser -D -u 10001 appuser
# Both runtimes — bots run Bash freely with bypassPermissions
RUN apk add --no-cache python3 py3-pip git bash curl
# Claude Code CLI — required by Agent SDK (spawns it as child process)
RUN npm install -g @anthropic-ai/claude-code
WORKDIR /app
COPY --from=build /app/dist/agent ./agent
COPY --from=build /app/dist/shared ./shared
COPY --from=build /app/node_modules ./node_modules
USER appuser
EXPOSE 3000
CMD ["node", "agent/entry.js"]
```

Single image, all bots use it. Bot-specific behavior comes from config + env vars. Tailscale joins the tailnet on boot (Phase 4).

## Dependencies (host CLI)

```json
{
  "commander": "^14.0",
  "dockerode": "^4.0",
  "yaml": "^2.0",
  "zod": "^3.0"
}
```

## Dependencies (container agent)

```json
{
  "@anthropic-ai/claude-agent-sdk": "^0.2",
  "hono": "^4.0",
  "@hono/node-server": "^1.0",
  "croner": "^9.0",
  "zod": "^3.0"
}
```

## Build Order

1. Dockerfile + agent/entry.ts + agent/server.ts — container accepts prompts
2. src/docker.ts + src/cli.ts — spawn, chat, ls, stop
3. agent/session.ts — per-task persistence
4. agent/tools/mecha-call.ts — bot-to-bot
5. agent/scheduler.ts — internal cron
6. agent/webhook.ts — allowlist + forward
7. src/auth.ts — profile management
8. Polish: init, rm, logs, auth swap
