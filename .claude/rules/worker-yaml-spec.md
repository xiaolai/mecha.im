---
description: Worker YAML specification — Docker-based workers with LLM CLI backends
globs: ["**/*.go", "workers/**/*.yml"]
---

# Worker YAML Specification

## Structure Detection

If YAML has `docker:` section → managed worker (mecha controls lifecycle).
If not → unmanaged (live) worker (mecha just calls the endpoint).

## Common Fields

```yaml
name: worker-name              # required, unique, matches [a-zA-Z0-9][a-zA-Z0-9_.-]*
endpoint: http://host:port     # for unmanaged workers only
timeout: 30m                   # task timeout (default: 10m)
```

## Docker Worker

All LLM workers run in Docker containers. Backend (Claude/Codex/Gemini) is
determined by the image. All config via `docker.env`.

```yaml
name: claude-reviewer
docker:
  image: ghcr.io/xiaolai/mecha-worker-claude:v1
  cwd: /path/to/project          # host dir mounted to /workspace
  resources:
    cpu: 4
    memory: 8G
    pids: 256
  lifecycle: persistent           # persistent only (disposable planned for Phase 3)
  env:
    CLAUDE_MODEL: claude-sonnet-4-6
    CLAUDE_SYSTEM_PROMPT: "You review PRs for security issues."
    CLAUDE_ALLOWED_TOOLS: "Read,Grep,Glob,Bash"
    CLAUDE_PERMISSION_MODE: bypassPermissions
    CLAUDE_EFFORT: high
    CLAUDE_OUTPUT_FORMAT: json
  token: claude.xiaolaidev        # resolved from ~/.mecha/secrets.yml
  labels:                         # optional custom labels
    team: security
timeout: 30m
```

## Token Precedence

1. `docker.token` → resolved from `~/.mecha/secrets.yml` → auto-detect env var by prefix
2. Merged into `docker.env`
3. Explicit `docker.env` values win on collision (user override)

## Workspace Mount

`docker.cwd` (host path) → `/workspace` (container, read-write).
Container runs with `--user $(id -u):$(id -g)` to match host UID/GID.
If `docker.cwd` is omitted, no workspace mount.

## Credential Mounts (planned — not yet implemented)

For subscription OAuth that requires host credential files:

| Backend | Host path | Container path | When needed |
|---|---|---|---|
| Codex | `~/.codex/` | `/home/worker/.codex/:ro` | ChatGPT login auth |
| Gemini | `~/.gemini/` | `/home/worker/.gemini/:ro` | Google OAuth auth |

Claude subscription uses `CLAUDE_CODE_OAUTH_TOKEN` env var (no file mount needed).

## Worker Image Contract

Every mecha worker image must:
- Expose port `8080`
- Serve `GET /health` → `200 OK` when ready (503 when busy)
- Serve `POST /task` → result contract JSON
- Include `HEALTHCHECK` in Dockerfile
- Read config from env vars (no config files inside container)
- Set `WORKER_BACKEND` env var (`claude`, `codex`, or `gemini`)

## Claude Env Vars

| Env var | CLI flag |
|---|---|
| `CLAUDE_MODEL` | `--model` |
| `CLAUDE_SYSTEM_PROMPT` | `--system-prompt` |
| `CLAUDE_ALLOWED_TOOLS` | `--allowed-tools` |
| `CLAUDE_DISALLOWED_TOOLS` | `--disallowed-tools` |
| `CLAUDE_PERMISSION_MODE` | `--permission-mode` |
| `CLAUDE_EFFORT` | `--effort` |
| `CLAUDE_OUTPUT_FORMAT` | `--output-format` |
| `CLAUDE_MAX_BUDGET_USD` | `--max-budget-usd` |
| `CLAUDE_CODE_OAUTH_TOKEN` | Auth (subscription) |
| `ANTHROPIC_API_KEY` | Auth (API key) |

Claude backend uses the Agent SDK `query()` directly (not CLI flags).
Env vars are mapped to SDK options in `docker/runtime/backends/claude.ts`.

## Codex Env Vars

| Env var | CLI flag / config |
|---|---|
| `CODEX_MODEL` | `--model` |
| `CODEX_SANDBOX` | `--sandbox` |
| `CODEX_FULL_AUTO` | `--full-auto` (set to `"true"` to enable) |
| `CODEX_EFFORT` | `-c model_reasoning_effort='"VALUE"'` |
| `OPENAI_API_KEY` | Auth |

Note: `codex exec` runs without approval prompts by default. `--full-auto` enables
auto-approve + workspace-write. The `--ask-for-approval` flag is TUI-only (not `exec`).

Exec: `codex exec --model $CODEX_MODEL --sandbox $CODEX_SANDBOX "prompt"`

## Gemini Env Vars

| Env var | CLI flag |
|---|---|
| `GEMINI_MODEL` | `--model` |
| `GEMINI_SANDBOX` | `--sandbox` |
| `GEMINI_APPROVAL_MODE` | `--approval-mode` |
| `GEMINI_OUTPUT_FORMAT` | `--output-format` |
| `GEMINI_API_KEY` | Auth |

Exec: `gemini --model $GEMINI_MODEL -p "prompt"`

## Model Discovery (planned — not yet implemented)

Cache: `~/.mecha/models.json` — written by `mecha serve` (Phase 3).
Script: `scripts/refresh-models.sh` — discovery logic.

See `.claude/rules/secrets.md` for token types, resolution, and redaction.
