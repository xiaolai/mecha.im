---
title: What is Mecha?
description: Mecha runs an army of Claude Code bots on your own machines — scheduled, sandboxed, and organized in a tree.
---

# What is Mecha?

[[toc]]

Mecha lets you run an army of bots on your own machines. Each bot is a Claude Code process with its own workspace, identity, and schedule.

## Why

You need more than one AI assistant. You need a team — a coder, a reviewer, a researcher, a monitor — each focused on its own job, running on your hardware, under your control.

Mecha makes this possible. It wraps Claude Code (specifically) into managed processes called **bots**. You define a bot with a markdown file, spawn it, and let it work.

## Bots are markdown files

A bot's identity lives in a markdown file. The file defines its system prompt, instructions, and constraints. Mecha reads the file, spawns a Claude Code session with those settings, and manages the process.

```
bots/
├── coder/
│   ├── CLAUDE.md          ← the bot's identity
│   ├── config.json        ← port, workspace, model, schedule
│   └── sessions/          ← conversation history (JSONL)
├── reviewer/
│   └── ...
└── researcher/
    └── ...
```

Each bot gets its own workspace directory, chat sessions, MCP tools, and API budget.

## Active, not passive

Most AI setups wait for you to type something. Mecha bots can be active:

- **Scheduled** — run tasks on a cron schedule (check logs every hour, review PRs daily)
- **Responsive** — listen for events via webhooks or mesh queries from other bots
- **Autonomous** — work through multi-step tasks independently within their sandbox

A bot sitting idle is a bot not earning its keep.

## Tree structure

Bots are organized in a tree. A machine runs a node. A node manages bots. Multiple nodes form a mesh.

```
mesh
├── macbook (node)
│   ├── coder
│   ├── reviewer
│   └── researcher
├── server-01 (node)
│   ├── monitor
│   └── deployer
└── server-02 (node)
    └── data-analyst
```

Bots on different machines talk to each other through mesh queries. Permissions control who can talk to whom.

## Built on Claude Code

Mecha is not a generic AI framework. It runs Claude Code — the same CLI tool Anthropic ships. Every bot gets the full Claude Code toolset: file editing, bash execution, web search, MCP servers.

This means your bots can do real work: write code, run tests, read documentation, manage files. They operate in real workspaces on real filesystems.

## What's Next?

- [Install Mecha](/guide/installation) — `brew install xiaolai/tap/mecha`
- [Quick Start](/guide/quickstart) — zero to a working bot in 5 minutes
- [Core Concepts](/guide/concepts) — deep dive into the architecture
