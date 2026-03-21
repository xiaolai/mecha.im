# Mecha

Run an army of bots on your own machines. Each bot is a Claude Code process with its own workspace, identity, and schedule.

## Why

You need more than one AI assistant. You need a team — a coder, a reviewer, a researcher, a monitor — each focused on its own job, running on your hardware, under your control.

Mecha makes this possible. It wraps Claude Code (specifically) into managed processes called **bots**. You define a bot with a markdown file — its system prompt, permissions, schedule, tools. Then Mecha spawns it, sandboxes it, and keeps it running.

## What a bot is

A bot is a markdown file that becomes a Claude Code process.

The markdown file defines who the bot is — its personality, instructions, and constraints. Mecha reads the file, spawns a Claude Code session with those settings, and manages the process lifecycle.

```
bots/
├── coder/
│   ├── CLAUDE.md          ← the bot's identity and instructions
│   ├── config.json        ← port, workspace, model, schedule
│   └── sessions/          ← conversation history (JSONL)
├── reviewer/
│   ├── CLAUDE.md
│   ├── config.json
│   └── sessions/
└── researcher/
    ├── CLAUDE.md
    ├── config.json
    └── sessions/
```

## Active, not passive

Most AI setups wait for you to type something. Mecha bots can be **active**:

- **Scheduled** — run tasks on a cron schedule (check logs every hour, review PRs daily)
- **Responsive** — listen for events via webhooks or mesh queries from other bots
- **Autonomous** — work through multi-step tasks independently within their sandbox

A bot sitting idle is a bot not earning its keep.

## Tree structure

Each bot is a directory with a markdown file. Organize them in a tree — group by project, team, or role. The directory structure is your org chart.

```
bots/
├── frontend/
│   ├── coder/
│   │   └── CLAUDE.md     ← "You write React components..."
│   ├── reviewer/
│   │   └── CLAUDE.md     ← "You review PRs for quality..."
│   └── tester/
│       └── CLAUDE.md     ← "You write and maintain tests..."
├── backend/
│   ├── api-dev/
│   │   └── CLAUDE.md     ← "You build API endpoints..."
│   └── db-admin/
│       └── CLAUDE.md     ← "You manage database migrations..."
└── ops/
    ├── monitor/
    │   └── CLAUDE.md     ← "You watch logs and alert on errors..."
    └── deployer/
        └── CLAUDE.md     ← "You run deployments on schedule..."
```

Each markdown file defines a bot's identity, instructions, and constraints. Mecha reads the file and spawns a Claude Code process from it.

## Built on Claude Code

Mecha is not a generic AI framework. It runs Claude Code — the same CLI tool Anthropic ships. Every bot gets the full Claude Code toolset: file editing, bash execution, web search, MCP servers.

This means your bots can do real work: write code, run tests, read documentation, manage files. They operate in real workspaces on real filesystems.

## Install

```bash
brew install xiaolai/tap/mecha
```

## Quick start

```bash
# Initialize
mecha init

# Start the runtime (background)
mecha start -d

# Spawn a bot
mecha bot spawn coder ~/my-project

# Chat with it
mecha bot chat coder "refactor the auth module"

# Give it a schedule
mecha schedule add coder --cron "0 9 * * *" --prompt "review open PRs and summarize"
```

## Features

- **CLI-first** — every feature works from the terminal. The dashboard is optional.
- **Sandboxed** — each bot runs in OS-level isolation (macOS sandbox-exec, Linux bwrap)
- **Metered** — track API costs per bot, set daily budgets, auto-pause overspenders
- **Networked** — bots query each other through a permission-controlled mesh
- **Persistent** — conversation history survives restarts as plain JSONL files
- **Multi-machine** — deploy across machines, manage from one place

## License

ISC
