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

Bots are organized in a tree. A machine runs a node. A node manages bots. Multiple nodes form a mesh.

```
mesh
├── macbook (node)
│   ├── coder (bot)
│   ├── reviewer (bot)
│   └── researcher (bot)
├── server-01 (node)
│   ├── monitor (bot)
│   └── deployer (bot)
└── server-02 (node)
    └── data-analyst (bot)
```

Bots on different machines talk to each other through mesh queries. Permissions control who can talk to whom.

## Built on Claude Code

Mecha is not a generic AI framework. It runs Claude Code — the same CLI tool Anthropic ships. Every bot gets the full Claude Code toolset: file editing, bash execution, web search, MCP servers.

This means your bots can do real work: write code, run tests, read documentation, manage files. They operate in real workspaces on real filesystems.

## Quick start

```bash
# Start the runtime
mecha start

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
