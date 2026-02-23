# Getting Started

Mecha is a local-first multi-agent runtime where each **Mecha** is a sandboxed [CASA](https://docs.anthropic.com/en/docs/claude-agent-sdk) (Claude Agent SDK App) instance.

## What is Mecha?

Mecha lets you spin up isolated Claude agents as sandboxed processes, each with its own workspace, tools, and permissions. You manage them through a simple CLI or web dashboard.

## Key Concepts

- **Mecha** — A running sandboxed Claude agent instance
- **CASA** — Claude Agent SDK App, the runtime powering each Mecha
- **Project Path** — The local directory used as the agent's workspace

## Quick Start

```bash
# Install
pnpm add -g @mecha/cli

# Create and start a new agent
mecha up ./my-project

# List running agents
mecha ls

# Stop an agent
mecha stop <mecha-id>
```

See the [Installation guide](./installation) for detailed setup instructions.
