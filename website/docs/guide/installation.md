---
title: Installation
description: Download and install the Mecha runtime binary.
---

# Installation

[[toc]]

## Download the Binary

Mecha is distributed as a single binary — no package manager required.

### macOS (Apple Silicon)

```bash
curl -L -o mecha https://github.com/xiaolai/mecha.im/releases/latest/download/mecha-darwin-arm64
chmod +x mecha
sudo mv mecha /usr/local/bin/
```

### macOS (Intel)

```bash
curl -L -o mecha https://github.com/xiaolai/mecha.im/releases/latest/download/mecha-darwin-x64
chmod +x mecha
sudo mv mecha /usr/local/bin/
```

### Linux (x86_64)

```bash
curl -L -o mecha https://github.com/xiaolai/mecha.im/releases/latest/download/mecha-linux-x64
chmod +x mecha
sudo mv mecha /usr/local/bin/
```

### Linux (ARM64)

```bash
curl -L -o mecha https://github.com/xiaolai/mecha.im/releases/latest/download/mecha-linux-arm64
chmod +x mecha
sudo mv mecha /usr/local/bin/
```

## Build from Source

If you prefer to build from source:

```bash
git clone https://github.com/xiaolai/mecha.im.git
cd mecha.im

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Build standalone binary (requires bun)
./scripts/build-binaries.sh
```

The binary will be at `dist/bin/current/mecha`.

## Prerequisites

- **Anthropic API key** or **Claude Code OAuth token** — at least one is required to power agents
- **Claude Code CLI** — `npm install -g @anthropic-ai/claude-code` (the SDK runtime that each agent uses)

## Verify Installation

```bash
mecha --version
```

## Environment Setup

Set your API credentials:

```bash
# Option 1: API key (never expires)
export ANTHROPIC_API_KEY=sk-ant-api03-...

# Option 2: OAuth token (preferred, 1-year lifespan)
export CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...
```

Or use the auth management commands:

```bash
# Add an API key profile
mecha auth add mykey --api-key --token sk-ant-api03-...

# Verify it works
mecha auth test mykey
```

## System Check

Run the built-in doctor to verify your environment:

```bash
mecha doctor
```

This checks:
- Node.js availability (v20+)
- Claude Code CLI installation
- Sandbox support (macOS sandbox-exec or Linux bwrap)
- Mecha directory structure (`~/.mecha/`)

## Initialize

Create the mecha directory structure:

```bash
mecha init
```

This creates `~/.mecha/` where all agent state, logs, and configuration are stored.

## Next Steps

Head to the [Quick Start](/guide/quickstart) to create your first agent.
