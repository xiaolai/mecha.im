# Mecha v5 — Implementation Plan

> Revised 2026-03-26 after SDK research, Codex review, and industry analysis.

## What Mecha Is

A **compose layer for Claude instances**. Declarative bot configurations → `query()` calls. Like Docker Compose is to `docker run`.

## What Mecha Is NOT

- Not an orchestration framework
- Not a process manager / daemon
- Not a credential store
- Not a session manager
- Not a cost tracker

Those are Claude SDK's concerns. Mecha just reads config and calls the SDK.

## The Product

```
mecha.yml              ← the compose file (committed to git)
mecha.local.yml        ← local overrides (gitignored)
```

```bash
mecha run <bot> [prompt]       ← run a bot
mecha run <bot> --resume <id>  ← resume session
mecha run <bot> --continue     ← resume last session
mecha ls                       ← list bots from mecha.yml
mecha config [bot]             ← show resolved config
mecha init                     ← scaffold mecha.yml
```

Five commands. One config file.

## mecha.yml Format

```yaml
bots:
  reviewer:
    model: claude-sonnet-4-6
    cwd: /path/to/project
    settingSources: [user, project]
    allowedTools: [Read, Grep, Glob, Bash]
    permissionMode: plan
    mcpServers:
      github:
        command: gh
        args: [mcp]
    env:
      ANTHROPIC_API_KEY: ${WORK_KEY}

  writer:
    model: claude-opus-4-6
    cwd: /path/to/content
    systemPrompt: "You write technical blog posts..."
    maxBudgetUsd: 10
    maxTurns: 50
    env:
      ANTHROPIC_API_KEY: ${PERSONAL_KEY}

  ops:
    model: claude-sonnet-4-6
    cwd: /path/to/infra
    settingSources: [user, project]
    allowedTools: [Read, Grep, Glob, Bash, Write, Edit]
    permissionMode: auto
    mcpServers:
      github:
        command: gh
        args: [mcp]
    env:
      ANTHROPIC_API_KEY: ${OPS_KEY}
```

### Config Fields (Direct SDK Options Passthrough)

Every field maps 1:1 to Claude Agent SDK `query()` options:

| Field | SDK Option | Purpose |
|---|---|---|
| `model` | `model` | Claude model |
| `fallbackModel` | `fallbackModel` | Backup model |
| `systemPrompt` | `systemPrompt` | Bot identity (string or preset) |
| `cwd` | `cwd` | Working directory |
| `settingSources` | `settingSources` | Load CLAUDE.md, rules, skills, hooks |
| `allowedTools` | `allowedTools` | Auto-approved tools |
| `disallowedTools` | `disallowedTools` | Blocked tools |
| `permissionMode` | `permissionMode` | Permission level |
| `mcpServers` | `mcpServers` | MCP server configs |
| `addDirs` | `additionalDirectories` | Extra accessible directories |
| `maxTurns` | `maxTurns` | Turn limit |
| `maxBudgetUsd` | `maxBudgetUsd` | Spending cap |
| `effort` | `effort` | Thinking depth |
| `env` | `env` | Environment variables |
| `agents` | `agents` | Subagent definitions |
| `hooks` | `hooks` | Filesystem hooks (via settingSources) |
| `outputFormat` | `outputFormat` | Structured output schema |
| `persistSession` | `persistSession` | Enable/disable session persistence |
| `plugins` | `plugins` | Plugin configs |

No translation layer. Mecha doesn't invent its own config schema — it uses the SDK's.

### Environment Variable Interpolation

```yaml
env:
  ANTHROPIC_API_KEY: ${WORK_KEY}        # from host env
  GITHUB_TOKEN: ${GH_TOKEN}
  CUSTOM_VAR: "literal value"           # no interpolation
```

`${VAR}` is replaced from `process.env` at runtime. Secrets never stored in the YAML.

### YAML Anchors for Base Configs

```yaml
bots:
  _base: &base
    model: claude-sonnet-4-6
    settingSources: [user, project]
    allowedTools: [Read, Grep, Glob]

  reviewer:
    <<: *base
    cwd: /path/to/project

  writer:
    <<: *base
    model: claude-opus-4-6
    cwd: /path/to/content
```

Free inheritance via YAML — no custom code.

### Override Files

```
mecha.yml           ← shared, committed
mecha.local.yml     ← personal, gitignored
```

Local overrides are deep-merged on top of shared config. Use for:
- Machine-specific paths (`cwd`)
- Personal API keys (`env`)
- Local MCP servers

## Source Structure

```
mecha/
├── src/
│   └── index.ts          ← everything (~300 lines)
├── package.json
├── tsconfig.json
└── README.md
```

One file. Maybe split to two if it grows:

```
mecha/
├── src/
│   ├── config.ts         ← parse, interpolate, merge, validate
│   └── index.ts          ← CLI commands + query() wrapper
├── package.json
└── tsconfig.json
```

## Dependencies

| Package | Purpose |
|---|---|
| `@anthropic-ai/claude-agent-sdk` | The engine |
| `commander` | CLI argument parsing |
| `yaml` | Parse mecha.yml |

Three dependencies. That's all.

## What the Workspace Provides (Not Mecha)

A bot's workspace supplies everything that makes it a "real bot." Mecha doesn't manage any of this — the workspace does:

```
/workspace/
├── CLAUDE.md              ← bot instructions, loaded via settingSources
├── .claude/
│   ├── rules/*.md         ← auto-loaded rules
│   ├── skills/            ← on-demand skills
│   ├── settings.json      ← hooks, permissions
│   └── agent-memory/      ← persistent memory across sessions
├── .mcp.json              ← workspace-specific MCP servers
└── (project files)
```

Mecha points Claude at the workspace (`cwd`). Claude loads everything else.

## GitHub Integration (Not Mecha)

Orchestration, scheduling, and communication live in GitHub, not in Mecha:

```yaml
# .github/workflows/daily-review.yml
on:
  schedule:
    - cron: '0 9 * * *'
jobs:
  review:
    runs-on: self-hosted
    steps:
      - run: mecha run reviewer "review yesterday's PRs"
```

Mecha doesn't know about GitHub. GitHub knows about Mecha.

## Repo Structure (Mecha + Shannon)

Shannon (the Go execution service from sha.nnon.ai) and Mecha compose into one product:

```
mecha.im/
├── mecha/                     ← CLI compose layer (~300 lines TS)
│   ├── src/index.ts
│   ├── package.json
│   └── tsconfig.json
├── shannon/                   ← execution service (Go)
│   ├── cmd/shannon/
│   ├── internal/
│   ├── go.mod
│   └── go.sum
├── action/                    ← GitHub Action
├── worker/                    ← Docker worker image
├── website/                   ← landing page
├── dev-docs/                  ← architecture, plans, research
└── mecha.yml                  ← example config
```

- `mecha run` — local execution, calls `query()` directly
- `mecha-action` — CI execution via Shannon in Docker containers
- Same `mecha.yml` drives both

## Estimated Size

| Component | Language | Lines |
|---|---|---|
| mecha CLI | TypeScript | ~300 |
| Shannon | Go | ~5,000 (growing) |
| GitHub Action | TypeScript | ~200 |
| Worker image | Dockerfile + entrypoint | ~100 |
| **Total** | | **~5,600** |

Down from 33,000 lines of TypeScript.

## Not In Scope

Everything that was in v4 and doesn't belong in a compose layer:

- Process management / daemons
- Per-bot HTTP servers
- Credential stores
- Session management UI
- Cost tracking / metering proxy
- P2P mesh networking
- Message bus
- Workflow engine
- Team deployment
- Sandbox isolation
- MCP server
- Dashboard / SPA
- Scheduling
- Observability / tracing
