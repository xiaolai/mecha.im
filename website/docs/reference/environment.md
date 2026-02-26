# Environment Variables

All environment variables recognized by Mecha.

## Authentication

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key for agent inference. Takes precedence over auth profiles. |
| `CLAUDE_CODE_OAUTH_TOKEN` | OAuth token for Claude Code. Preferred over API keys (longer lifespan). |

## Agent Server

| Variable | Description |
|----------|-------------|
| `MECHA_AGENT_API_KEY` | API key for the inter-node agent server. Alternative to `--api-key` flag. |

## Directories

| Variable | Description |
|----------|-------------|
| `MECHA_DIR` | Override the default `~/.mecha/` directory for all state and configuration. |

## Internal (Set by Runtime)

These are set automatically when a CASA process starts. Do not set manually.

| Variable | Description |
|----------|-------------|
| `MECHA_CASA_NAME` | Name of the current CASA |
| `MECHA_PORT` | Port the CASA runtime listens on |
| `MECHA_WORKSPACE` | Path to the CASA's workspace |
| `MECHA_PROJECTS_DIR` | Workspace-specific projects directory inside the CASA |
| `MECHA_AUTH_TOKEN` | Bearer token for the CASA API |
| `MECHA_LOG_DIR` | Path to the CASA's log directory |
| `MECHA_SANDBOX_ROOT` | Path to the CASA's root directory |

## Resolution Priority

When spawning a CASA, credentials are resolved in this order:

1. CLI flag (`--auth <profile>`)
2. Environment variables (`ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`)
3. Default auth profile (`mecha auth default`)
