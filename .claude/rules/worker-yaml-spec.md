---
description: Worker YAML specification — Docker-based workers with LLM CLI backends
globs: ["**/*.go", "workers/**/*.yml"]
---

# Worker YAML Specification

## Structure Detection

If YAML has `docker:` section → managed worker (mecha controls lifecycle).
If YAML has `adapter:` section → adapter worker (in-process LLM API translation).
If YAML has `endpoint:` field → unmanaged (live) worker (mecha just calls the endpoint).

## Common Fields

```yaml
name: worker-name              # required, unique, matches [a-zA-Z0-9][a-zA-Z0-9_.-]*
endpoint: http://host:port     # for unmanaged workers only
timeout: 30m                   # task timeout (default: 10m)
events:                        # event routing rules (optional)
  - source: github
    on: [pull_request.opened]
    filter: {base_branch: main}
    prompt: "Review PR #{{.number}}"
    auto: true                 # auto-dispatch (default: true)
policy:                        # write-back policy (optional, default: AllowAll)
  comment: {allow: true, max_length: 10000}
  labels: {allow: true, allowed: [bug], blocked: [approved]}
  status: {allow: true}
  commit: {allow: true, max_size: 50000}
  metadata: {allow: false}
```

## Docker Worker

The unified image runs Claude as the primary backend via the Agent SDK.
Codex is available as an MCP tool when credentials are mounted. All config
via `docker.env`.

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
  plugins:                         # optional, installed at container start via `claude plugin install`
    - pr-review-toolkit
    - codex-toolkit
  plugin_marketplaces:             # optional, added before plugin install
    - https://github.com/anthropics/claude-code-plugins.git
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
- Expose port `8080` (Caddy proxies to Bun on 8081 internally)
- Serve `GET /health` → `200 OK` when ready (503 when busy)
- Serve `POST /task` → result contract JSON
- Include `HEALTHCHECK` in Dockerfile
- Read config from env vars (no config files inside container)

## Claude Env Vars

| Env var | CLI flag |
|---|---|
| `CLAUDE_MODEL` | `--model` |
| `CLAUDE_SYSTEM_PROMPT` | `--system-prompt` |
| `CLAUDE_ALLOWED_TOOLS` | `--allowed-tools` |
| `CLAUDE_DISALLOWED_TOOLS` | `--disallowed-tools` |
| `CLAUDE_PERMISSION_MODE` | `--permission-mode` |
| `CLAUDE_EFFORT` | `--effort` |
| `CLAUDE_MAX_BUDGET_USD` | `--max-budget-usd` |
| `CLAUDE_MAX_TURNS` | `--max-turns` |
| `CLAUDE_CODE_OAUTH_TOKEN` | Auth (subscription) |
| `ANTHROPIC_API_KEY` | Auth (API key) |

Claude backend uses the Agent SDK `query()` directly (not CLI flags).
`CLAUDE_PERMISSION_MODE` defaults to `bypassPermissions` (SDK default for
non-interactive use) — no need to set it unless you want to restrict.
Env vars are mapped to SDK options in `docker/runtime/backends/claude.ts`.

## Codex MCP Integration

Codex runs as an MCP child process inside the Claude backend, not as a
standalone executor. The runtime auto-detects Codex availability:

| Env var | Purpose |
|---|---|
| `CODEX_MCP` | Force-enable Codex MCP (`"true"`) — not needed if credentials mounted |
| `CODEX_API_KEY` | API key for non-subscription users (auto-enables MCP) |

**Auto-detection**: The backend checks for `~/.codex/auth.json` (mounted via
`credentials: [codex]`) or `CODEX_API_KEY` in env. If either is present,
`codex mcp-server` is spawned as a stdio child process.

Auth: `credentials: [codex]` (preferred — mounts `~/.codex/` with login session) or
`CODEX_API_KEY` env var (not `OPENAI_API_KEY`).

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

## Docker Image Layers

```
mecha-worker-base          <- common runtime
├── mecha-worker-claude    <- + Claude SDK + CLI
├── mecha-worker-codex     <- + OpenAI SDK + Codex CLI
├── mecha-worker-gemini    <- + Google AI SDK
└── mecha-worker-ollama    <- + Ollama client (Ollama runs elsewhere)
```

Base image includes: bash, git, curl, jq, ripgrep, make/gcc/g++, openssh-client,
python3, node 22, bun. Excludes: gh CLI (writes go through mecha), docker,
cloud CLIs, linters, editors (project-specific or unnecessary).

### Per-Project Extension

```dockerfile
FROM mecha-worker-claude:latest
RUN apt-get update && apt-get install -y golang-go
```

Or specify a custom image in worker YAML:

```yaml
name: claude-go-project
docker:
  image: my-registry/mecha-worker-claude-go:latest
```

See `.claude/rules/secrets.md` for token types, resolution, and redaction.
