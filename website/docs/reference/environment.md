# Environment Variables

All environment variables recognized by Mecha.

## Authentication

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key for agent inference. Takes precedence over auth profiles. |
| `CLAUDE_CODE_OAUTH_TOKEN` | OAuth token for Claude Code. Preferred over API keys (longer lifespan). |

## Server

| Variable | Description |
|----------|-------------|
| `SERVER_SECRET_PATH` | Path to a file containing the 32-byte HMAC secret for relay tokens. If not set, an ephemeral secret is generated on each server start. |

## Debugging

| Variable | Description |
|----------|-------------|
| `MECHA_LOG_LEVEL` | Log verbosity: `debug`, `info`, `warn`, or `error`. Defaults to `info`. |
| `MECHA_OTP` | TOTP secret supplied via environment (alternative to file-based storage). Useful for CI, containers, and automated deployments. |

## Directories

| Variable | Description |
|----------|-------------|
| `MECHA_DIR` | Override the default `~/.mecha/` directory for all state and configuration. |

## Internal (Set by Runtime)

These are set automatically when a bot process starts. Do not set manually.

| Variable | Description |
|----------|-------------|
| `MECHA_BOT_NAME` | Name of the current bot |
| `MECHA_PORT` | Port the bot runtime listens on |
| `MECHA_WORKSPACE` | Path to the bot's workspace |
| `MECHA_PROJECTS_DIR` | Workspace-specific projects directory inside the bot |
| `MECHA_AUTH_TOKEN` | Bearer token for the bot API |
| `MECHA_LOG_DIR` | Path to the bot's log directory |
| `MECHA_SANDBOX_ROOT` | Path to the bot's root directory |

## Resolution Priority

When spawning a bot, credentials are resolved in this order:

1. CLI flag (`--auth <profile>`)
2. Environment variables (`ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`)
3. Default auth profile (`mecha auth default`)
