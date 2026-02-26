# Configuration

## Auth Profiles

Mecha supports multiple authentication profiles for different API credentials.

### Adding Profiles

```bash
# Add an API key
mecha auth add --anthropic-key sk-ant-api03-...

# Add an OAuth token (preferred — longer lifespan)
mecha auth add --oauth-token sk-ant-oat01-...

# Tag a profile for organization
mecha auth tag <profile-name> work
```

### Managing Profiles

```bash
# List all profiles
mecha auth ls

# Set default profile
mecha auth default <profile-name>

# Switch active profile
mecha auth switch <profile-name>

# Test connectivity
mecha auth test

# Renew an OAuth token
mecha auth renew <profile-name>

# Remove a profile
mecha auth rm <profile-name>
```

### Resolution Priority

When spawning a CASA, credentials are resolved in this order:

1. CLI flags (`--anthropic-key`, `--claude-token`)
2. Environment variables (`ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`)
3. Default auth profile
4. `.env` file in the workspace directory

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key for agent inference |
| `CLAUDE_CODE_OAUTH_TOKEN` | OAuth token (preferred over API key) |
| `MECHA_OTP` | One-time password for TOTP-protected agents |
| `MECHA_AGENT_API_KEY` | API key for the inter-node agent server |
| `MECHA_DIR` | Override default `~/.mecha/` directory |

## CASA Configuration

Each CASA has a `config.json`:

```json
{
  "port": 7700,
  "token": "random-bearer-token",
  "workspace": "/Users/you/my-project",
  "tags": ["dev", "backend"],
  "expose": ["query"],
  "version": 1
}
```

Update configuration with:

```bash
mecha configure researcher --tag research --tag ml
```

## Port Assignment

Mecha auto-assigns ports from the 7700-7799 range. To use a specific port:

```bash
mecha spawn researcher ~/papers --port 7710
```

## Sandbox Modes

Control the OS sandbox level per CASA:

| Mode | Behavior |
|------|----------|
| `strict` | Full sandbox enforcement — fails if sandbox unavailable |
| `auto` | Uses sandbox when available, degrades with warning |
| `off` | No OS sandbox (not recommended) |

Check sandbox status:

```bash
mecha sandbox show researcher
```
