# Mecha v5 — Design Discussion

> Captured from the architectural review session on 2026-03-26.

## The Starting Question

Reviewing the mecha.im project (v4.x), the question was raised: **have we overcomplicated this?**

Mecha's only meaningful purpose is creating customized bot(s) on demand — Claude Agent SDK instances, essentially isolated local Claude Code CLI instances. Whether they persist doesn't matter.

All orchestration and communication should be handled by an external service. GitHub is the best candidate.

Telegram integration should work differently: users talk to a Claude instance that controls Mecha via Telegram, not a raw channel.

## What v4 Had

17 packages, ~33,000 lines of TypeScript:

| Package | Lines | Purpose |
|---|---|---|
| cli | 7,026 | 100+ commands |
| runtime | 3,705 | Per-bot Fastify HTTP server |
| core | 3,769 | Types, schemas, validation, identity, crypto |
| service | 2,848 | Business logic orchestration |
| connect | 2,609 | P2P networking (STUN, hole-punch, Noise, relay) |
| process | 2,191 | Bot process lifecycle |
| meter | 2,095 | Cost tracking proxy between bots and Anthropic API |
| agent | 1,439 | Discovery server, mDNS, auth hooks |
| server | 1,300 | Signaling + relay server for P2P mesh |
| mcp-server | 1,243 | MCP tools for fleet control |
| bus | 869 | Durable message broker (queues + topics) |
| workflow | 822 | DAG execution engine |
| observe | 774 | Tracing, metrics, A/B experiments |
| teams | 547 | Declarative team deployment |
| sandbox | 535 | macOS SBPL / Linux seccomp isolation |
| gateway | 514 | External service adapters |
| integration | — | Test suite only |

## Decisions Made (in order)

### 1. GitHub replaces orchestration infrastructure

Bus, workflow, teams, connect, server, observe, gateway — all replaced by GitHub services:

- **GitHub Issues + Labels** → task queue (replaces bus)
- **GitHub Actions** → scheduling and workflows (replaces workflow, scheduling)
- **GitHub Repos** → workspace context, team configs (replaces teams)
- **GitHub API** → inter-bot communication (replaces connect, mesh)
- **GitHub UI** → dashboard (replaces SPA)
- **GitHub Webhooks** → external triggers (replaces gateway)

### 2. Sandbox is optional

Mecha is purely local. User's own machine, own bots, own API keys. No trust boundary to enforce. Sandbox was for multi-tenant/untrusted scenarios that no longer apply.

### 3. Per-bot HTTP servers are unnecessary

The runtime package existed because bots needed to receive mesh queries, expose bus/workflow/task MCP tools, serve session data to the dashboard, and provide health check endpoints.

Without mesh, bus, workflow, or dashboard — a bot is just a Claude SDK process with stdin/stdout. No ports, no Fastify, no per-bot HTTP.

Process health = "is the PID alive?"

### 4. Meter proxy is unnecessary

The meter was a man-in-the-middle HTTP proxy between bots and api.anthropic.com. It intercepted every API call, parsed SSE streams, computed costs, and enforced per-bot budget limits.

But Claude SDK already attaches `usage` (input_tokens, output_tokens, cache tokens) to every response. The `.jsonl` transcripts have all cost data. Cost tracking becomes reading transcript files and multiplying by a pricing table — a 50-line function, not a 2,100-line proxy package.

The only thing lost is real-time budget enforcement (blocking requests before they happen). Not worth 2,100 lines.

### 5. MCP server is redundant

The MCP server's tools (`list_bots`, `bot_status`, `query`, `workspace_read`, `discover`) are just wrappers around CLI operations. A Claude instance (e.g. the Telegram concierge) can call the CLI directly via shell. No MCP protocol needed.

### 6. Session management stays

Sessions are the core interaction model. Users need to resume conversations, list history, and track costs per session. Claude SDK writes `.jsonl` transcripts natively — session management is filesystem reads on existing data.

### 7. Auth management is essential

Multiple Claude API keys / OAuth tokens per user. Users with multiple Claude Max Pro subscriptions need to assign different credentials to different bots.

## Telegram Model

**Wrong (v4):**
```
User → Telegram Bot → raw API → Mecha runtime → bot
```

**Right (v5):**
```
User → Telegram → Claude instance ("concierge")
                        ├── runs `mecha spawn`, `mecha chat`, etc.
                        ├── runs `gh issue create`, `gh workflow run`, etc.
                        └── reports results back via Telegram
```

The concierge is a Claude instance with a system prompt and shell access. It interprets user intent in natural language, manages the fleet via CLI, and reports back. Zero custom bridge code needed.

## What Survives

~2,500–3,500 lines ported/refined from v4:

| Source | What | ~Lines |
|---|---|---|
| `core/` | Config schema, bot name validation, errors, atomic writes | 600 |
| `process/` | Spawn logic, env construction, pid tracking, lifecycle | 800 |
| `core/` | Auth profile storage, credential resolution | 400 |
| `cli/` | Commander.js patterns, output formatting | 500 |
| `meter/` | Pricing table, `computeCost()` function only | 50 |

## What Dies

~30,000 lines across: bus, workflow, teams, connect, server, sandbox, meter proxy, MCP server, runtime, agent, observe, gateway, dashboard, SPA.

## Further Simplification (Session-First Model)

After Codex critical review, the plan was further simplified:

- **No process management** — bots are configs, not processes. No spawn/stop/kill/PID tracking.
- **No auth module** — just `${ENV_VARS}` in config. No credential store.
- **No session module** — Claude SDK owns sessions. Pass `--resume`.
- **No cost module** — Anthropic dashboard shows usage.

A bot is a **named configuration** that parameterizes a Claude SDK `query()` call.

## Final Model: Compose Layer

Mecha is a **compose layer for Claude instances** — like Docker Compose is to `docker run`.

```yaml
# mecha.yml
bots:
  reviewer:
    model: claude-sonnet-4-6
    cwd: /path/to/project
    settingSources: [user, project]
    env:
      ANTHROPIC_API_KEY: ${WORK_KEY}
```

```bash
mecha run reviewer "review PR #42"
# → reads config → calls query() → streams output
```

~300 lines of TypeScript. Three dependencies (SDK, commander, yaml).
