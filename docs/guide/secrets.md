---
title: Secrets
description: Managing API tokens and credentials for workers.
---

# Secrets

Mecha stores tokens in `~/.mecha/secrets.yml`. Workers reference tokens by name — the actual values never appear in worker YAML files.

## Setup

```bash
mkdir -p ~/.mecha
chmod 700 ~/.mecha
```

Create the secrets file:

```yaml
# ~/.mecha/secrets.yml
tokens:
  claude:
    xiaolaidev: sk-ant-oat01-xxx...    # Claude subscription (setup token)
    lixiaolai: sk-ant-oat01-yyy...     # different subscription
    api: sk-ant-api03-zzz...           # Claude API key (pay-per-token)
  codex:
    default: sk-xxx...                 # OpenAI API key
  gemini:
    default: AIza...                   # Google API key
```

Set permissions:

```bash
chmod 600 ~/.mecha/secrets.yml
```

Mecha warns if the file is readable by others.

## Getting Tokens

### Claude (subscription)

```bash
claude setup-token
```

This outputs a token starting with `sk-ant-oat01-`. Valid for 1 year.

### Claude (API key)

Get from [console.anthropic.com](https://console.anthropic.com). Starts with `sk-ant-api03-`. Pay-per-token billing.

### Codex (API key)

Get from [platform.openai.com](https://platform.openai.com). Starts with `sk-`.

### Gemini (API key)

Get from [aistudio.google.com/apikey](https://aistudio.google.com/apikey). Starts with `AIza`.

## Referencing Tokens in Worker YAML

Use `docker.token` with a `backend.name` reference:

```yaml
name: reviewer
docker:
  image: mecha-worker-claude:latest
  token: claude.xiaolaidev    # → resolves to sk-ant-oat01-xxx...
```

Mecha auto-detects the token type by its prefix and sets the correct environment variable in the container:

| Token prefix | Environment variable set |
|---|---|
| `sk-ant-oat01-` | `CLAUDE_CODE_OAUTH_TOKEN` |
| `sk-ant-api03-` | `ANTHROPIC_API_KEY` |
| `sk-` | `OPENAI_API_KEY` |
| `AIza` | `GEMINI_API_KEY` |

## Multi-Account Claude

Different workers can use different Claude subscriptions:

```yaml
# workers/reviewer-a.yml
name: reviewer-a
docker:
  image: mecha-worker-claude:latest
  token: claude.xiaolaidev        # subscription account A

# workers/reviewer-b.yml
name: reviewer-b
docker:
  image: mecha-worker-claude:latest
  token: claude.lixiaolai         # subscription account B
```

No `CLAUDE_CONFIG_DIR` juggling needed. Each setup token is bound to its account.

## Token Precedence

When a worker starts, environment variables are assembled in this order:

1. `docker.token` resolved from `secrets.yml` → auto-detected env var
2. `docker.env` values merged (explicit values win on collision)
3. `HOME=/tmp` set for non-root container user

So if you set both `token: claude.work` and `env: { CLAUDE_CODE_OAUTH_TOKEN: ... }`, the explicit `env` value wins.

## Security

- Tokens are injected as container environment variables, not CLI arguments
- `GITHUB_TOKEN`, `GH_TOKEN`, and related keys are **blocked** — workers cannot receive GitHub credentials
- Env values that look like GitHub PATs (`ghp_*`, `ghs_*`, etc.) are rejected
- Error messages are redacted before display — token patterns replaced with `[REDACTED]`
