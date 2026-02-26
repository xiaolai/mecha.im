# Configuration

## Auth Profiles

Mecha supports multiple authentication profiles for different API credentials.

### Adding Profiles

```bash
# Add an API key profile
mecha auth add mykey --api-key --token sk-ant-api03-...

# Add an OAuth token profile (preferred — longer lifespan)
mecha auth add mytoken --oauth --token sk-ant-oat01-...

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
mecha auth test <profile-name>

# Renew an OAuth token
mecha auth renew <profile-name> <new-token>

# Remove a profile
mecha auth rm <profile-name>
```

### Resolution Priority

When spawning a CASA, credentials are resolved in this order:

1. CLI flag (`--auth <profile>`)
2. Environment variables (`ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`)
3. Default auth profile (`mecha auth default`)

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key for agent inference |
| `CLAUDE_CODE_OAUTH_TOKEN` | OAuth token (preferred over API key) |
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
mecha configure researcher --tags research,ml
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
| `require` | Full sandbox enforcement — fails if sandbox unavailable |
| `auto` | Uses sandbox when available, warns if unavailable (default) |
| `off` | No OS sandbox (not recommended) |

Check sandbox status:

```bash
mecha sandbox show researcher
```
