# Installation

## Requirements

- **Node.js 22+**
- **Docker** — Colima, Docker Desktop, OrbStack, or any OCI runtime
- **Claude Code** — installed and authenticated (`npm install -g @anthropic-ai/claude-code`)
- **Tailscale** (optional) — for multi-machine bot-to-bot mesh

## Install via npm

```bash
npm install -g mecha
```

## Initialize

```bash
mecha init
```

This builds the Mecha Docker image locally. The image is based on Alpine and includes Node.js, Claude Code, and s6-overlay for process management.

If you plan to use Tailscale for multi-machine communication:

```bash
mecha init --headscale
```

## Verify

```bash
mecha --version
mecha doctor
```

`mecha doctor` checks that Docker is running, the image is built, and Claude Code is available.

## Set Up Auth

The simplest approach — export your API key:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Or use named profiles for managing multiple keys:

```bash
mecha auth add anthropic-main sk-ant-...
mecha auth list
```

Profiles are stored at `~/.mecha/auth/<name>.json`.
