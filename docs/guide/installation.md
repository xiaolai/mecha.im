---
title: Installation
description: Install mecha and set up your environment.
---

# Installation

## What You Need

Mecha is a single Go binary. What else you need depends on which worker types you plan to use:

| | Docker Workers | Adapter Workers | Unmanaged Workers |
|---|---|---|---|
| **What it does** | Runs Claude/Codex/Gemini in containers | Translates Ollama/vLLM APIs in-process | Calls your existing HTTP endpoint |
| **Go 1.26+** | Yes | Yes | Yes |
| **Docker 28+** | Yes | No | No |
| **LLM running locally** | No (bundled in image) | Yes (Ollama, vLLM, etc.) | You manage it |

Most users start with **Docker workers** (Claude in a container). If you just want to connect a local Ollama or OpenAI-compatible API, use an **adapter worker** — no Docker needed.

## Install Mecha

### Option A: Build from Source

```bash
git clone https://github.com/xiaolai/mecha.im.git
cd mecha.im
make build
```

Copy the binary to your PATH:

```bash
sudo cp mecha /usr/local/bin/
```

### Option B: Go Install

```bash
go install mecha.im/cmd/mecha@latest
```

The binary goes to `$GOPATH/bin/`.

### Verify

```bash
mecha version
```

## Set Up Docker (for Docker Workers Only)

Skip this section if you only plan to use adapter or unmanaged workers.

### macOS

Use [Colima](https://github.com/abiosoft/colima) (lighter than Docker Desktop):

```bash
brew install colima docker
colima start --cpu 4 --memory 8
```

### Linux

```bash
# Ubuntu/Debian
sudo apt-get install docker.io
sudo systemctl enable --now docker
sudo usermod -aG docker $USER   # log out and back in
```

### Build Worker Images

```bash
make image-claude    # Claude Code CLI worker
make image-codex     # Codex CLI worker
make image-gemini    # Gemini CLI worker
```

Or build all three:

```bash
make images
```

Each image is built on `mecha-worker-base` (Ubuntu + Bun runtime + tools like git, curl, ripgrep).

## Set Up Secrets

Create `~/.mecha/secrets.yml` with tokens for your LLM backends:

```bash
mkdir -p ~/.mecha
chmod 700 ~/.mecha
```

```yaml
# ~/.mecha/secrets.yml
tokens:
  claude:
    default: sk-ant-oat01-...    # from: claude setup-token
  codex:
    default: sk-...              # OpenAI API key
  gemini:
    default: AIza...             # Google API key

# For GitHub webhooks + write-back (optional)
github:
  token: ghp_...
  webhook_secret: whsec_...

# For GitLab webhooks (optional)
gitlab:
  webhook_secret: your_secret
```

Lock permissions:

```bash
chmod 600 ~/.mecha/secrets.yml
```

Only include the sections you need. The file is optional — workers can fall through to host CLI defaults (e.g., `~/.claude/.credentials.json`).

## Cross-Platform Builds

Build for other platforms:

```bash
GOOS=linux GOARCH=amd64 make build    # Linux x86_64
GOOS=linux GOARCH=arm64 make build    # Linux ARM64
```

Worker Docker images must be built on each target architecture or via `docker buildx` for multi-arch.

## What's Next

- [Quick Start](./quickstart) — run your first worker in 5 minutes
- [Workers](./workers) — all worker types and YAML fields
- [Secrets](./secrets) — token management in detail
