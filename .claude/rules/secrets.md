---
description: Secrets management — per-machine secrets file, resolution order, redaction
globs: "**/*.go"
---

# Secrets Management

## File Location

```
~/.mecha/secrets.yml     ← per-machine, never committed, mode 0600
```

## Format

Stores subscription tokens and API keys:

```yaml
tokens:
  claude:
    xiaolaidev: sk-ant-oat01-xxx...    # subscription setup token
    lixiaolai: sk-ant-oat01-yyy...     # different subscription
  codex:
    default: sk-xxx...                 # API key → CODEX_API_KEY (not OPENAI_API_KEY)

github:
  token: ghp_xxx...
```

## Auth Strategy

**Optimized for subscription users.** Prefer subscription auth for Docker workers.

| CLI | Docker worker auth | Method |
|-----|---|---|
| Claude | `credentials: claude` or `token: claude.name` | Credential mount or OAuth env var |
| Codex | `credentials: codex` or `token: codex.name` | Credential mount or `CODEX_API_KEY` env var |

Gemini is not supported as a managed Docker worker — its credential files are
scrypt-encrypted to hostname+username, not portable into containers.
Use Gemini API endpoints as unmanaged workers instead.

### How to authenticate each CLI on the host

| CLI | Command | Headless? | What it creates |
|---|---|---|---|
| Claude | `claude setup-token` | Yes | Portable token for `~/.mecha/secrets.yml` |
| Claude | `claude login` | Yes | Credentials in `~/.claude/` |
| Codex | `codex login` | Yes (browser) | Session in `~/.codex/auth.json` |
| Codex | `codex login --device-auth` | Yes (URL+code) | Session in `~/.codex/auth.json` |
| Codex | `codex login --with-api-key` | Yes (stdin) | Key in `~/.codex/auth.json` |

## How Workers Reference Auth

### Credential mounts (Claude, Codex)

Mount host CLI credential directory read-only into the container.
The CLI inside uses its native auth flow — no env var injection needed.

```yaml
name: codex-coder
docker:
  image: mecha-worker:latest
  credentials: codex             # mounts ~/.codex/ → /home/worker/.codex/:ro
  env:
    CODEX_MODEL: gpt-5.4
```

### Token injection

`docker.token` resolves from `~/.mecha/secrets.yml` and injects as an env var.

```yaml
# Claude multi-account via subscription tokens
name: reviewer-a
docker:
  image: mecha-worker:latest
  token: claude.xiaolaidev       # sk-ant-oat01-... → CLAUDE_CODE_OAUTH_TOKEN

# Codex via API key
name: codex-coder
docker:
  image: mecha-worker:latest
  token: codex.default            # sk-... → CODEX_API_KEY
```

Mecha auto-detects token type by prefix:

| Prefix | Env var set |
|---|---|
| `sk-ant-oat` | `CLAUDE_CODE_OAUTH_TOKEN` |
| `sk-ant-` | `ANTHROPIC_API_KEY` |
| `sk-` | `CODEX_API_KEY` |

`docker.credentials` and `docker.token` are mutually exclusive.

## Resolution Order

### Claude

1. `credentials: claude` → mounts `~/.claude/` read-only
2. `token: claude.name` → from `~/.mecha/secrets.yml`, sets `CLAUDE_CODE_OAUTH_TOKEN`
3. Fall through to host default (Keychain / `~/.claude/.credentials.json`)

### Codex

1. `credentials: codex` → mounts `~/.codex/` read-only (subscription login session)
2. `token: codex.name` → from `~/.mecha/secrets.yml`, sets `CODEX_API_KEY`
3. `CODEX_API_KEY` env var directly in `docker.env`

Note: Codex CLI reads `CODEX_API_KEY`, not `OPENAI_API_KEY`, at runtime.

### Gemini

Not supported as a managed Docker worker. Use unmanaged endpoints.

## Redaction

All log output and error messages must redact these patterns
(canonical list — matches `internal/worker/redact.go`):

- `sk-ant-*` (Anthropic OAuth + API)
- `sk-*` (OpenAI, 20+ chars)
- `ghp_*` (GitHub PAT)
- `ghs_*` (GitHub server token)
- `ghr_*` (GitHub refresh token)
- `gho_*` (GitHub OAuth token)
- `ghu_*` (GitHub user-to-server token)
- `ghes_*` (GitHub Enterprise Server token)
- `github_pat_*` (GitHub fine-grained PAT)
- `AIza*` (Google API key, 30+ chars)
- `ya29.*` (Google OAuth access token)
- `glpat-*` (GitLab PAT)
- `Bearer *` (Bearer tokens)

## Rules

- Secrets file is optional. Workers can fall through to host CLI defaults.
- Prefer `credentials:` (subscription auth) for Claude and Codex Docker workers.
- Mecha loads secrets once at startup, holds in memory, never persists.
- Workers receive secrets via environment variables or read-only credential mounts, never CLI args.
- Credential mounts are always read-only. Workers cannot modify host credentials.
- Secrets file must be mode 0600. Mecha warns if permissions are too open.
- Token type is auto-detected by prefix. No manual type annotation needed.
