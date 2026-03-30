# Mecha

**Run AI on your PRs. Your infra. Your rules.**

Mecha turns GitHub events into LLM tasks — one Go binary, YAML config, policy-controlled write-back.

```
GitHub webhook → match worker → dispatch prompt → policy filter → write back
```

## What it does

- **Multi-LLM** — Claude, Codex, Gemini in Docker containers. Ollama and OpenAI-compatible via adapters. Switch models in one YAML line.
- **Event-driven** — GitHub and GitLab webhooks trigger workers automatically. Generic webhooks for anything else.
- **Policy-controlled** — decide what each worker can write back: comments, labels, status checks, commit suggestions. Block what you don't want.
- **Self-hosted** — single binary, runs on your machine or server. No cloud dependency. Your code stays on your infra.

## Quick look

Define a worker:

```yaml
name: pr-reviewer
docker:
  image: mecha-worker-claude:latest
  token: claude.default
  env:
    CLAUDE_MODEL: claude-sonnet-4-6
    CLAUDE_EFFORT: high
events:
  - source: github
    on: [pull_request.opened, pull_request.synchronize]
    prompt: "Review this PR for security issues.\n\n{{.diff}}"
policy:
  comment: { allow: true, max_length: 2000 }
  labels: { allow: true }
  status: { allow: true }
  commit: { allow: false }
```

Start it:

```bash
mecha worker add workers/pr-reviewer.yml
mecha worker start pr-reviewer
mecha serve --addr 0.0.0.0:8080
```

Every PR now gets an automated security review.

## Install

```bash
# Build from source
git clone https://github.com/xiaolai/mecha.im.git
cd mecha.im
make build
sudo cp mecha /usr/local/bin/

# Or via go install
go install mecha.im/cmd/mecha@latest
```

Requires Go 1.26+. Docker 28+ for container workers (optional for adapter workers).

## Three worker types

| Type | What | Docker needed? |
|------|------|---------------|
| **Managed** | LLM CLI in a Docker container | Yes |
| **Adapter** | In-process bridge to Ollama, vLLM, any OpenAI-compatible API | No |
| **Unmanaged** | Your existing HTTP endpoint | No |

## Architecture

Four nouns. One pipeline.

```
Event.arrive → Event.match → Task.create → Task.dispatch → Policy.filter → Task.complete
```

- **Event** — something happened (webhook)
- **Worker** — takes a prompt, returns a result
- **Task** — an event matched to a worker
- **Policy** — what the result is allowed to contain

Design principle: **dumb pipeline, smart step, policy gate.** The pipeline is deterministic. The LLM is the only smart part. Policy is the only governance checkpoint.

## Docs

**[mecha.im](https://mecha.im)** — full documentation including installation, worker config, secrets, events, policy, CLI reference, and API.

## Status

Under active development. Core pipeline is implemented and working:

- Worker lifecycle (Docker + adapters + unmanaged)
- Task dispatch with health checks and recovery
- GitHub + GitLab + generic webhook sources
- Event hydration (PR diffs, file lists)
- Policy-filtered write-back (comments, labels, status, commit suggestions)
- Disposable (one-shot) containers
- SQLite persistence with WAL mode

## License

MIT
