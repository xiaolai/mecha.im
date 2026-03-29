---
title: Getting Started
description: Learn what Mecha is, how it works, and how to use it.
---

# Getting Started

## What is Mecha

**Agentic Workflow Engine: Scheduling, Orchestrating, Managing Events.**

## Current Status

Mecha is under active development. The **Worker** noun is fully implemented with Docker container lifecycle. Event, Task, and Policy are designed but not yet implemented.

| Noun | Status |
|------|--------|
| **Worker** | Implemented — add, remove, start, stop, ls |
| **Event** | Designed — not yet implemented |
| **Task** | Designed — not yet implemented |
| **Policy** | Designed — not yet implemented |

## Four Nouns

The entire system is built on four concepts:

- **Event** — something happened.
- **Worker** — something that takes a prompt and returns a result.
- **Task** — an event matched to a worker. The only moving object.
- **Policy** — what a result is allowed to contain.

## One Pipeline

```text
Event → Task → Worker → Result (filtered by Policy) → done
```

## Workers

A worker is a Docker container running an LLM CLI that accepts tasks via HTTP:

- **Claude** — Docker container running Claude Code CLI
- **Codex** — Docker container running Codex CLI
- **Gemini** — Docker container running Gemini CLI
- **Any HTTP service** — on your Tailscale network or anywhere reachable

Workers are either **managed** (Docker containers started by mecha, shown as `managed` in `worker ls`) or **unmanaged** (services you run yourself, shown as `live`). At dispatch time, they all look the same: an HTTP endpoint serving `POST /task` and `GET /health`.

## CLI Commands

```bash
mecha version                      # print version
mecha worker add <path>            # add worker from YAML file or directory
mecha worker remove <name>         # remove worker (must be offline)
mecha worker start <name>          # start worker (offline → online)
mecha worker stop <name>           # stop worker (online → offline)
mecha worker ls                    # list workers with state and health
mecha config [name]                # show resolved worker configuration
```

## Worker YAML

### Managed (Docker) worker:

```yaml
name: claude-reviewer
docker:
  image: mecha-worker-claude:latest
  cwd: /path/to/project
  resources:
    cpu: 4
    memory: 8G
  lifecycle: persistent
  env:
    CLAUDE_MODEL: claude-sonnet-4-6
    CLAUDE_PERMISSION_MODE: bypassPermissions
    CLAUDE_EFFORT: high
  token: claude.xiaolaidev
timeout: 30m
```

### Unmanaged (live) worker:

```yaml
name: my-service
endpoint: http://100.64.0.3:8080
timeout: 10m
```

## Security

Workers never talk to GitHub. Mecha is the only thing that writes:

```text
Worker → mecha → Policy → GitHub
```

All writes go through Policy. One security boundary. One audit trail.

Workers receive LLM API tokens via container environment variables. GitHub tokens are blocked — a worker YAML that tries to inject `GITHUB_TOKEN` is rejected at start time.

## Build

```bash
make build     # build the mecha binary
make test      # run tests with race detector
make ci        # vet + test + build
make images    # build all Docker worker images
```
