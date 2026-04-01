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
  image: ghcr.io/xiaolai/mecha-worker:v1
  cwd: /path/to/project          # host dir mounted to /workspace
  credentials: [claude]           # mounts ~/.claude/ read-only (subscription auth)
  resources:
    cpu: 4
    memory: 8G
    pids: 256
  lifecycle: persistent           # persistent or disposable
  env:
    CLAUDE_MODEL: claude-sonnet-4-6
    CLAUDE_SYSTEM_PROMPT: "You review PRs for security issues."
    CLAUDE_ALLOWED_TOOLS: "Read,Grep,Glob,Bash"
    CLAUDE_EFFORT: high
  api_key: my-secret-key          # optional, enables Bearer auth on /task
  expose: true                    # optional, bind to 0.0.0.0 (default: 127.0.0.1)
  labels:                         # optional custom labels
    team: security
timeout: 30m
```

## Authentication

Optimized for subscription users. Prefer subscription auth where the CLI supports
headless use. API endpoints are better served as unmanaged workers.

### Credential Mounts (`docker.credentials`)

Bind-mounts the host CLI credential directory read-only into the container.
The CLI inside the container uses its native auth — no env var injection needed.

| `credentials:` | Host path | Container path | CLI auth method |
|---|---|---|---|
| `claude` | `~/.claude/` | `/home/worker/.claude/:ro` | Claude Code credentials |
| `codex` | `~/.codex/` | `/home/worker/.codex/:ro` | Codex login session |

When `credentials` is set, `HOME` is set to `/home/worker` so CLIs find their
credential files. The host credential dir must exist (run the CLI to authenticate first).

Claude also supports `docker.token` for OAuth token injection via env var
(`sk-ant-oat01-...` → `CLAUDE_CODE_OAUTH_TOKEN`). Both are subscription auth.

### Token Injection (`docker.token`)

1. `docker.token` → resolved from `~/.mecha/secrets.yml` → auto-detect env var by prefix
2. Merged into `docker.env`
3. Explicit `docker.env` values win on collision (user override)

`docker.credentials` and `docker.token` are mutually exclusive.

## Workspace Mount

`docker.cwd` (host path) → `/workspace` (container, read-write).
Container runs with `--user $(id -u):$(id -g)` to match host UID/GID.
If `docker.cwd` is omitted, no workspace mount.

## Worker Image Contract

Every mecha worker image must:
- Expose port `8080`
- Serve `GET /health` → `200 OK` when ready (503 when busy)
- Serve `POST /task` → result contract JSON
- Include `HEALTHCHECK` in Dockerfile
- Read config from env vars (no config files inside container)
- Set `WORKER_BACKEND` env var (`claude` or `codex`)

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
`CLAUDE_PERMISSION_MODE` defaults to `bypassPermissions` (SDK default for
non-interactive use) — no need to set it unless you want to restrict.
Env vars are mapped to SDK options in `docker/runtime/backends/claude.ts`.

## Codex Env Vars

| Env var | CLI flag / config |
|---|---|
| `CODEX_MODEL` | `--model` |
| `CODEX_SANDBOX` | `--sandbox` |
| `CODEX_FULL_AUTO` | `--full-auto` (set to `"true"` to enable) |
| `CODEX_EFFORT` | `-c model_reasoning_effort='"VALUE"'` |

Auth: `credentials: [codex]` (mounts `~/.codex/` with login session) or
`token: codex.name` (resolves to `CODEX_API_KEY` env var — not `OPENAI_API_KEY`).

Note: `codex exec` runs without approval prompts by default. `--full-auto` enables
auto-approve + workspace-write. The `--ask-for-approval` flag is TUI-only (not `exec`).

Exec: `codex exec --model $CODEX_MODEL --sandbox $CODEX_SANDBOX "prompt"`

## Gemini

Gemini is not supported as a managed Docker worker. Its credential files are
scrypt-encrypted to hostname+username, making them non-portable into containers.
Use Gemini API endpoints as unmanaged workers instead:

```yaml
name: gemini-coder
endpoint: http://localhost:8090
timeout: 30m
```

## Model Discovery (planned — not yet implemented)

Cache: `~/.mecha/models.json` — written by `mecha serve` (Phase 3).
Script: `scripts/refresh-models.sh` — discovery logic.

See `.claude/rules/secrets.md` for token types, resolution, and redaction.
