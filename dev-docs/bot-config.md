# Bot Configuration

## Format

Each bot is defined by a YAML file.

```yaml
name: reviewer
system: |
  You are a code reviewer. You review PRs for bugs,
  security issues, and style violations.
model: sonnet                          # claude model (default: sonnet)
auth: anthropic-main                   # auth profile name
max_turns: 25                          # tool-use loop safety cap

schedule:
  - cron: "*/30 * * * *"
    prompt: "Check for new unreviewed PRs."
  - cron: "0 9 * * *"
    prompt: "Write a daily summary of yesterday's changes."

webhooks:
  accept:
    - "pull_request.opened"
    - "pull_request.synchronize"
    - "issue_comment.created"

workspace: ./myproject                 # mounted read-only at /workspace
workspace_writable: false              # set true to mount as rw
expose: 8080                           # optional: map host port to container

tailscale:
  auth_key_profile: tailscale-main     # auth profile name for Tailscale
  # OR inline:
  # auth_key: tskey-auth-...
  login_server: https://headscale.example.com  # optional, for Headscale
  tags: ["tag:mecha-bot"]
```

## Fields

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `name` | yes | — | Bot identifier, used as container name |
| `system` | yes | — | System prompt defining bot behavior |
| `model` | no | `sonnet` | Claude model to use |
| `auth` | no | from `mecha.json` | Auth profile name for Anthropic API |
| `max_turns` | no | `25` | Max tool-use turns per query (safety cap) |
| `max_budget_usd` | no | — | Max cost per query in USD. SDK stops with `error_max_budget_usd` if exceeded. |
| `permission_mode` | no | `bypassPermissions` | SDK permission mode. Default suits autonomous bots. Requires `allowDangerouslySkipPermissions: true` in query() options (set automatically). |
| `schedule` | no | — | List of cron jobs with prompts |
| `webhooks.accept` | no | — | Event type allowlist for `/webhook` |
| `workspace` | no | — | Host path to mount at `/workspace` |
| `workspace_writable` | no | `false` | Mount workspace as read-write |
| `expose` | no | — | Host port for external access |
| `tailscale` | no | — | Tailscale connection config |
| `tailscale.auth_key_profile` | no | — | Auth profile name for Tailscale key |
| `tailscale.auth_key` | no | — | Inline Tailscale auth key |
| `tailscale.login_server` | no | — | Headscale URL (omit for Tailscale SaaS) |
| `tailscale.tags` | no | `["tag:mecha-bot"]` | Tailscale ACL tags |

## Bot Path

Bot state is stored at a user-specified path, not necessarily `~/.mecha/bots/<name>/`.

```bash
# State lives alongside config file
mecha spawn ./bots/reviewer/config.yaml

# Explicit state directory
mecha spawn reviewer.yaml --dir ~/my-bots/reviewer

# Fallback: ~/.mecha/bots/reviewer/
mecha spawn --name reviewer --system "..."
```

The resolved path is registered in `~/.mecha/registry.json` so all commands find it by name.

## Inline Spawn

Bots can be spawned without a config file:

```bash
mecha spawn --name researcher --system "You are a researcher." --model sonnet
```

This creates a minimal config at the resolved bot path.

## Schedule Syntax

Uses standard cron syntax (5 fields):

```yaml
schedule:
  - cron: "*/30 * * * *"              # every 30 minutes
    prompt: "Check for updates."
  - cron: "0 9 * * 1-5"              # weekdays at 9am
    prompt: "Morning standup report."
```

The schedule runs inside the container. Safety rails enforced:
- Max 50 runs per day
- 10 minute timeout per run
- Auto-pause after 5 consecutive errors
- One run at a time (skip if busy)

## Webhook Allowlist

The `webhooks.accept` field is a list of `{type}.{action}` patterns:

```yaml
webhooks:
  accept:
    - "pull_request.opened"           # new PR
    - "pull_request.synchronize"      # PR updated
    - "issue_comment.created"         # new comment
```

Events not matching the allowlist are silently dropped (no API call). Matched events are forwarded to the bot as a prompt with the full payload.

## Auth Profiles

Referenced by name. Stored at `~/.mecha/auth/<profile>.json`:

```json
{
  "type": "api_key",
  "key": "sk-ant-..."
}
```

Tailscale keys use the same system:

```json
{
  "type": "tailscale",
  "key": "tskey-auth-..."
}
```

Swap at runtime:

```bash
mecha auth swap reviewer anthropic-backup
# restarts container with new auth
```

## Validation Rules

Cross-field constraints checked at spawn time:

- `workspace` path must exist and be a directory
- `workspace_writable: true` requires explicit opt-in (not set by accident)
- `auth` profile must exist in `~/.mecha/auth/`
- `tailscale.auth_key` and `tailscale.auth_key_profile` are mutually exclusive
- `expose` port must be available on the host
- `max_turns` must be between 1 and 100
- Claude process must run as non-root user (`appuser`) inside the container — never root, even with `bypassPermissions`
