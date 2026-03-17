# Bot Config Schema

Complete schema for bot YAML configuration files.

```yaml
# Required
name: string          # 1-32 chars, lowercase alphanumeric + hyphens
system: string        # System prompt (min 1 char)

# Optional
model: string         # Default: "sonnet"
auth: string          # Auth profile name
max_turns: number     # 1-100, default: 25
max_budget_usd: number  # Positive number, spending cap
permission_mode: enum # default | acceptEdits | bypassPermissions | plan | dontAsk

schedule:             # Array of cron entries
  - cron: string      # 5-field cron expression
    prompt: string    # 1-10000 chars

webhooks:
  accept: string[]    # Event types to process
  secret: string      # HMAC-SHA256 verification secret

permissions:
  fleet_control: boolean  # Default: false — enables fleet MCP tools (orchestrator)

workspace: string     # Host path to mount
workspace_writable: boolean  # Default: false

expose: number        # Port mapping (1-65535)

tailscale:
  auth_key_profile: string  # Tailscale auth profile name
  auth_key: string          # Direct auth key (mutually exclusive with above)
  login_server: string      # Custom Headscale URL
  tags: string[]            # Default: ["tag:mecha-bot"]
```

## Permission Modes

| Mode | Behavior |
|------|----------|
| `default` | Standard Claude Code permissions |
| `acceptEdits` | Auto-accept file edits |
| `bypassPermissions` | Skip all permission prompts |
| `plan` | Plan-only mode (no execution) |
| `dontAsk` | Never prompt for confirmation |

## Validation Rules

- `name` must match `/^[a-z0-9][a-z0-9-]{0,31}$/`
- `cron` must be a valid 5-field cron expression
- `tailscale.auth_key` and `tailscale.auth_key_profile` are mutually exclusive
- `max_turns` is clamped to 1-100
- `expose` is clamped to 1-65535
