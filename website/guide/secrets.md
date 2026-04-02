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
    default: AIza...                   # Google API key (unmanaged workers only)
```

Set permissions:

```bash
chmod 600 ~/.mecha/secrets.yml
```

Mecha rejects the file with an error if permissions are too open (not `0600`).

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

## Webhook Secrets

Configure webhook signature verification for event sources:

```yaml
github:
  token: ghp_your_github_pat
  webhook_secret: whsec_your_webhook_secret

gitlab:
  webhook_secret: your_gitlab_secret

slack:
  signing_secret: your_slack_signing_secret

telegram:
  secret_token: your_telegram_bot_secret_token
```

| Source | Field | Verification |
|--------|-------|-------------|
| GitHub | `github.webhook_secret` | HMAC-SHA256 (`X-Hub-Signature-256`) |
| GitHub | `github.token` | PAT for API calls (diff fetch + write-back) |
| GitLab | `gitlab.webhook_secret` | Token comparison (`X-Gitlab-Token`) |
| Slack | `slack.signing_secret` | HMAC-SHA256 (`v0=` scheme) + replay protection |
| Telegram | `telegram.secret_token` | Token comparison (`X-Telegram-Bot-Api-Secret-Token`) |

Sources are only registered when their secrets are present. No secret = source disabled.

::: tip GitLab Write-Back
GitLab write-back (comments, commit status, labels) requires a GitLab Personal Access Token (PAT) with `api` scope. This is separate from `gitlab.webhook_secret` (which is for webhook verification only). The PAT is passed directly to `NewGitLabResponder(apiBase, token)` at registration time -- it is not stored in `secrets.yml`.
:::

## Referencing Tokens in Worker YAML

Use `docker.token` with a `backend.name` reference:

```yaml
name: reviewer
docker:
  image: mecha-worker:latest
  token: claude.xiaolaidev    # → resolves to sk-ant-oat01-xxx...
```

Mecha auto-detects the token type by its prefix and sets the correct environment variable in the container:

| Token prefix | Environment variable set |
|---|---|
| `sk-ant-oat*` | `CLAUDE_CODE_OAUTH_TOKEN` (subscription OAuth) |
| `sk-ant-*` (other) | `ANTHROPIC_API_KEY` (Console API key) |
| `sk-*` | `CODEX_API_KEY` |

## Multi-Account Claude

Different workers can use different Claude subscriptions:

```yaml
# workers/reviewer-a.yml
name: reviewer-a
docker:
  image: mecha-worker:latest
  token: claude.xiaolaidev        # subscription account A

# workers/reviewer-b.yml
name: reviewer-b
docker:
  image: mecha-worker:latest
  token: claude.lixiaolai         # subscription account B
```

No `CLAUDE_CONFIG_DIR` juggling needed. Each setup token is bound to its account.

## Token Precedence

When a worker starts, environment variables are assembled in this order:

1. `docker.token` resolved from `secrets.yml` → auto-detected env var
2. `docker.env` values merged (explicit values win on collision)
3. `HOME=/home/worker` when `credentials:` is used, otherwise `HOME=/tmp`

So if you set both `token: claude.work` and `env: { CLAUDE_CODE_OAUTH_TOKEN: ... }`, the explicit `env` value wins.

## Security

- Tokens are injected as container environment variables, not CLI arguments
- Reserved keys (`WORKER_BACKEND`, `WORKER_PORT`, `WORKER_API_KEY`, `WORKER_TIMEOUT`, `WORKER_DRY_RUN`, `HOME`) cannot be overridden via `docker.env`
- Error messages are redacted before display — token patterns replaced with `[REDACTED]`
