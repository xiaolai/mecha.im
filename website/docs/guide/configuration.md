# Bot Configuration

Bots are defined in YAML config files. Here's a full example:

```yaml
name: reviewer
system: |
  You are a code reviewer. You review PRs for bugs,
  security issues, and style violations.
model: sonnet
auth: anthropic-main
max_turns: 25
max_budget_usd: 1.00
permission_mode: default

schedule:
  - cron: "*/30 * * * *"
    prompt: "Check for new unreviewed PRs."

webhooks:
  accept:
    - "pull_request.opened"
    - "pull_request.synchronize"
  secret: whsec_...

workspace: ./myproject
workspace_writable: false
expose: 8080

tailscale:
  auth_key_profile: ts-main
  tags:
    - "tag:mecha-bot"
```

## Fields

### Required

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Bot name (lowercase alphanumeric + hyphens, 1-32 chars) |
| `system` | string | System prompt — the bot's identity and instructions |

### Optional

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `model` | string | `"sonnet"` | Claude model to use |
| `auth` | string | — | Auth profile name (from `mecha auth add`) |
| `max_turns` | number | `25` | Max turns per conversation (1-100) |
| `max_budget_usd` | number | — | Spending cap in USD |
| `permission_mode` | string | `"default"` | One of: `default`, `acceptEdits`, `bypassPermissions`, `plan`, `dontAsk` |

### Schedule

```yaml
schedule:
  - cron: "*/30 * * * *"
    prompt: "Check for new unreviewed PRs."
  - cron: "0 9 * * 1"
    prompt: "Generate weekly summary report."
```

Each entry needs a 5-field cron expression and a prompt. See [Scheduling](/features/scheduling) for safety rails.

### Webhooks

```yaml
webhooks:
  accept:
    - "pull_request.opened"
    - "push"
  secret: whsec_...
```

The `accept` array filters which GitHub event types the bot processes. The optional `secret` enables webhook signature verification. See [Webhooks](/features/webhooks).

### Workspace

```yaml
workspace: ./myproject
workspace_writable: false
```

Mounts a host directory into the container. Read-only by default. See [Workspaces](/features/workspaces).

### Tailscale

```yaml
tailscale:
  auth_key_profile: ts-main
  tags:
    - "tag:mecha-bot"
  login_server: https://headscale.example.com
```

Connects the container to a Tailscale/Headscale network for bot-to-bot communication. See [Tailscale Mesh](/features/tailscale).

### Expose

```yaml
expose: 8080
```

Maps the bot's internal HTTP port to the host. Useful for webhook receivers.

## Inline Spawning

For quick bots, skip the config file:

```bash
mecha spawn --name greeter --system "You greet people warmly." --model sonnet
```
