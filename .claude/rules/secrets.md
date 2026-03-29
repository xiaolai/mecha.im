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

Stores both **subscription OAuth tokens** and **API keys**:

```yaml
tokens:
  claude:
    xiaolaidev: sk-ant-oat01-xxx...    # subscription setup token
    lixiaolai: sk-ant-oat01-yyy...     # different subscription
    api: sk-ant-api03-zzz...           # Console API key (pay-per-token)
  codex:
    default: sk-xxx...                 # OpenAI API key
    chatgpt: eyJ...                    # ChatGPT OAuth (JWT)
  gemini:
    default: AIza...                   # Google API key

github:
  token: ghp_xxx...
```

## Token Types

| CLI | Subscription (OAuth) | API Key |
|-----|---------------------|---------|
| Claude | `sk-ant-oat01-...` via `claude setup-token` | `sk-ant-api03-...` from Console |
| Codex | via `codex login` (stored in `~/.codex/auth.json`) | `sk-...` from OpenAI |
| Gemini | via Google OAuth (stored in `~/.gemini/oauth_creds.json`) | `AIza...` from Google Cloud |

## How Workers Reference Tokens

```yaml
name: reviewer
claude:
  model: claude-sonnet-4-6
  token: claude.xiaolaidev       # resolved from secrets.yml
```

Mecha sets the right env var per CLI:

| `token:` resolves to | CLI | Env var set |
|---|---|---|
| `sk-ant-oat01-...` | claude | `CLAUDE_CODE_OAUTH_TOKEN` |
| `sk-ant-api03-...` | claude | `ANTHROPIC_API_KEY` |
| `sk-...` | codex | `OPENAI_API_KEY` |
| `AIza...` | gemini | `GEMINI_API_KEY` |

Note: Codex and Gemini subscription auth uses CLI-managed credential files
(`codex login`, Google OAuth). For these, omit `token:` and let the CLI
fall through to its host default. Only API keys go in `secrets.yml`.

Mecha auto-detects token type by prefix and sets the correct env var.

## Claude Multi-Account

No `CLAUDE_CONFIG_DIR` needed. Each setup token is bound to a specific
subscription account. Just set `CLAUDE_CODE_OAUTH_TOKEN` per worker:

```yaml
# Worker using xiaolaidev subscription
name: reviewer-a
claude:
  token: claude.xiaolaidev

# Worker using lixiaolai subscription
name: reviewer-b
claude:
  token: claude.lixiaolai
```

Setup tokens are generated via `claude setup-token`, valid for 1 year.

## Resolution Order

Worker `token:` field resolved in this order:

### Claude

1. `token: claude.name` → from `~/.mecha/secrets.yml`, sets `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` (auto-detected by prefix)
2. Fall through to host default (Keychain / `~/.claude/.credentials.json`)

### Codex

1. `token: codex.name` → from `~/.mecha/secrets.yml`, sets `OPENAI_API_KEY`
2. Fall through to host default (`~/.codex/auth.json`)

### Gemini

1. `token: gemini.name` → from `~/.mecha/secrets.yml`, sets `GEMINI_API_KEY`
2. Fall through to host default (`~/.gemini/oauth_creds.json`)

## Redaction

All log output and error messages must redact patterns:

- `sk-ant-*` (Anthropic OAuth + API)
- `sk-*` (OpenAI)
- `ghp_*`, `ghs_*`, `ghr_*`, `github_pat_*` (GitHub)
- `ya29.*` (Google OAuth)
- `AIza*` (Google API key)
- `Bearer *`
- `eyJ*` (JWTs, first 20 chars only)

## Rules

- Secrets file is optional. Workers can fall through to host CLI defaults.
- Mecha loads secrets once at startup, holds in memory, never persists.
- Workers receive secrets via environment variables only, never CLI args.
- Secrets file must be mode 0600. Mecha warns if permissions are too open.
- Token type is auto-detected by prefix. No manual type annotation needed.
