---
title: Installation
description: Install Mecha and set up your environment.
---

# Installation

[[toc]]

## Homebrew (recommended)

```bash
brew install xiaolai/tap/mecha
```

This installs the `mecha` binary and the dashboard SPA. Works on macOS (Apple Silicon and Intel) and Linux.

## Manual Download

Download the binary for your platform from the [latest release](https://github.com/xiaolai/mecha.im/releases/latest):

::: code-group

```bash [macOS (Apple Silicon)]
curl -L https://github.com/xiaolai/mecha.im/releases/latest/download/mecha-darwin-arm64.tar.gz | tar xz
sudo mv mecha /usr/local/bin/
```

```bash [macOS (Intel)]
curl -L https://github.com/xiaolai/mecha.im/releases/latest/download/mecha-darwin-x64.tar.gz | tar xz
sudo mv mecha /usr/local/bin/
```

```bash [Linux (x86_64)]
curl -L https://github.com/xiaolai/mecha.im/releases/latest/download/mecha-linux-x64.tar.gz | tar xz
sudo mv mecha /usr/local/bin/
```

```bash [Linux (ARM64)]
curl -L https://github.com/xiaolai/mecha.im/releases/latest/download/mecha-linux-arm64.tar.gz | tar xz
sudo mv mecha /usr/local/bin/
```

:::

## Build from Source

```bash
git clone https://github.com/xiaolai/mecha.im.git
cd mecha.im
pnpm install
pnpm build
./scripts/build-binaries.sh
```

The binary will be at `dist/bin/current/mecha`.

## Verify

```bash
mecha --version
```

## Prerequisites

You need one of these to power your bots:

- **Anthropic API key** — `ANTHROPIC_API_KEY=sk-ant-api03-...`
- **Claude Code OAuth token** — `CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...` (preferred, longer lifespan)

Set it as an environment variable, or use the auth command (covered in the [Quick Start](/guide/quickstart)).

## Next Steps

Head to the [Quick Start](/guide/quickstart) to create your first bot.
