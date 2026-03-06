---
title: Configuration
description: Configure auth profiles, bot settings, sandbox modes, and runtime options.
---

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

When spawning a bot, credentials are resolved in this order:

1. CLI flag (`--auth <profile>`)
2. Environment variables (`ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`)
3. Default auth profile (`mecha auth default`)

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key for agent inference |
| `CLAUDE_CODE_OAUTH_TOKEN` | OAuth token (preferred over API key) |
| `MECHA_DIR` | Override default `~/.mecha/` directory |

## bot Configuration

Each bot has a `config.json`:

```json
{
  "configVersion": 1,
  "port": 7700,
  "token": "random-bearer-token",
  "workspace": "/Users/you/my-project",
  "home": "/opt/bots/researcher",
  "model": "claude-sonnet-4-20250514",
  "permissionMode": "default",
  "auth": "mykey",
  "tags": ["dev", "backend"],
  "expose": ["query"],
  "sandboxMode": "auto",
  "allowNetwork": false
}
```

| Field | Type | Description |
|-------|------|-------------|
| `configVersion` | number | Schema version (currently `1`) |
| `port` | number | HTTP port for the runtime API |
| `token` | string | Random Bearer token for API auth |
| `workspace` | string | Absolute path to the workspace directory (CWD) |
| `home` | string? | Custom HOME directory. Defaults to `~/.mecha/<name>/` |
| `model` | string? | Model override for this bot |
| `permissionMode` | string? | `default`, `plan`, or `full-auto` (see below) |
| `auth` | string? | Auth profile name |
| `tags` | string[]? | Tags for organization and discovery |
| `expose` | string[]? | Capabilities exposed to the mesh |
| `sandboxMode` | string? | `auto`, `off`, or `require` |
| `allowNetwork` | boolean? | Allow outbound network access (reserved) |

### Permission Modes

| Mode | Behavior |
|------|----------|
| `default` | Agent asks for approval before executing tools (safest) |
| `plan` | Agent can read files and search, but asks approval for writes and commands |
| `full-auto` | Agent executes all tools without asking (use with sandbox enforcement) |

Update configuration with:

```bash
mecha bot configure researcher --tags research,ml
```

## Port Assignment

Mecha auto-assigns ports from the 7700-7799 range. To use a specific port:

```bash
mecha bot spawn researcher ~/papers --port 7710
```

## Sandbox Modes

Control the OS sandbox level per bot:

| Mode | Behavior |
|------|----------|
| `require` | Full sandbox enforcement — fails if sandbox unavailable |
| `auto` | Uses sandbox when available, warns if unavailable (default) |
| `off` | No OS sandbox (not recommended) |

Check sandbox status:

```bash
mecha sandbox show researcher
```
