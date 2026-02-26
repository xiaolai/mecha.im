# Environment Variables

All environment variables recognized by Mecha.

## Authentication

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key for agent inference. Takes precedence over auth profiles. |
| `CLAUDE_CODE_OAUTH_TOKEN` | OAuth token for Claude Code. Preferred over API keys (longer lifespan). |
| `MECHA_OTP` | TOTP secret for agents that require one-time password authentication. |

## Agent Server

| Variable | Description |
|----------|-------------|
| `MECHA_AGENT_API_KEY` | API key for the inter-node agent server. Alternative to `--api-key` flag. |

## Directories

| Variable | Description |
|----------|-------------|
| `MECHA_DIR` | Override the default `~/.mecha/` directory for all state and configuration. |
| `MECHA_PROJECTS_DIR` | Points to the workspace-specific projects directory inside a CASA. Set automatically by the runtime. |

## Internal (Set by Runtime)

These are set automatically when a CASA process starts. Do not set manually.

| Variable | Description |
|----------|-------------|
| `MECHA_CASA_NAME` | Name of the current CASA |
| `MECHA_CASA_DIR` | Path to the CASA's root directory |
| `MECHA_WORKSPACE` | Path to the CASA's workspace |
| `MECHA_RUNTIME_PORT` | Port the CASA runtime listens on |
| `MECHA_RUNTIME_TOKEN` | Bearer token for the CASA API |

## Resolution Priority

When spawning a CASA, credentials are resolved in this order:

1. CLI flags (`--anthropic-key`, `--claude-token`)
2. Environment variables (`ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`)
3. Default auth profile (`mecha auth default`)
4. `.env` file in the workspace directory
