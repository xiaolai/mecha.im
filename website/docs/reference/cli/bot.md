---
title: Bot Commands
description: CLI reference for mecha bot lifecycle management commands
---

# Bot Commands

[[toc]]

All bot commands live under `mecha bot`.

## `mecha bot spawn`

Create and start a new bot process.

```bash
mecha bot spawn <name> [path] [options]
```

| Argument | Description |
|----------|-------------|
| `<name>` | bot name (lowercase, alphanumeric, hyphens) |
| `[path]` | Workspace directory path (defaults to home directory) |

| Option | Description | Default |
|--------|-------------|---------|
| `--home <dir>` | Home directory for the bot | `~/.mecha/<name>/` |
| `-p, --port <number>` | Port to listen on | auto-assign (7700-7799) |
| `--auth <profile>` | Auth profile to use (see `mecha auth ls`) | |
| `--no-auth` | Spawn without Claude API credentials | |
| `--tags <tags>` | Comma-separated tags | |
| `--expose <caps>` | Comma-separated capabilities to expose (`query`, `read_workspace`, `write_workspace`, `execute`, `read_sessions`, `lifecycle`) | |
| `--sandbox <mode>` | Sandbox mode: `auto`, `off`, `require` | `auto` |
| `--model <model>` | Model to use | |
| `--permission-mode <mode>` | Permission mode: `default`, `plan`, `bypassPermissions`, `acceptEdits`, `dontAsk`, `auto` | |
| `--meter <mode>` | Meter mode: `on`, `off` | `on` |
| `--system-prompt <prompt>` | System prompt override | |
| `--append-system-prompt <prompt>` | Append to default system prompt | |
| `--effort <level>` | Effort level: `low`, `medium`, `high` | |
| `--max-budget-usd <dollars>` | Max USD budget per session | |
| `--allowed-tools <tools>` | Comma-separated allowed tools | |
| `--disallowed-tools <tools>` | Comma-separated disallowed tools | |
| `--tools <tools>` | Override tool set (comma-separated) | |
| `--add-dir <dirs>` | Comma-separated additional directories | |
| `--agent <name>` | Agent preset name | |
| `--no-session-persistence` | Disable session persistence | |
| `--mcp-config <paths>` | Comma-separated MCP config file paths | |
| `--strict-mcp-config` | Only use specified MCP servers | |
| `--plugin-dir <dirs>` | Comma-separated plugin directories | |
| `--disable-slash-commands` | Disable all skills | |
| `--dangerously-skip-permissions` | Skip all permission checks (requires `--sandbox require`) | |
| `--allow-dangerously-skip-permissions` | Allow `--dangerously-skip-permissions` without defaulting to it | |
| `--fallback-model <model>` | Fallback model when primary is overloaded | |
| `--budget-limit <dollars>` | Mecha-level aggregate budget cap | |

When `[path]` is omitted, CWD defaults to `--home` (or `~/.mecha/<name>/` if `--home` is also omitted). A warning is emitted if CWD is not under HOME.

```bash
mecha bot spawn researcher ~/papers --tags research,ml
mecha bot spawn coder ~/project --permission-mode bypassPermissions --sandbox require --port 7710
mecha bot spawn helper ~/docs --no-auth
mecha bot spawn worker ~/code --meter off
mecha bot spawn alice --home /opt/bots/alice   # HOME and CWD both at /opt/bots/alice
mecha bot spawn alice                           # HOME and CWD both at ~/.mecha/alice/
mecha bot spawn writer ~/blog --system-prompt "You are a technical writer."
mecha bot spawn coder ~/project --effort high --max-budget-usd 5.00
mecha bot spawn sandbox ~/code --allowed-tools Bash,Read,Write
mecha bot spawn assistant ~/docs --agent reviewer --mcp-config ~/mcp.json
```

## `mecha bot start`

Start a stopped bot from its persisted `config.json`.

```bash
mecha bot start <name>
```

| Argument | Description |
|----------|-------------|
| `<name>` | bot name |

Re-reads the bot's `config.json` and spawns a new process from it. Allocates a fresh port. Errors if the bot is already running or if no config exists.

```bash
mecha bot start researcher
```

## `mecha bot stop`

Gracefully stop a bot (SIGTERM).

```bash
mecha bot stop <name> [options]
```

| Argument | Description |
|----------|-------------|
| `<name>` | bot name |

| Option | Description | Default |
|--------|-------------|---------|
| `--force` | Stop even if bot has active sessions | `false` |

Without `--force`, the command checks for active sessions and refuses to stop a busy bot.

```bash
mecha bot stop researcher
mecha bot stop researcher --force
```

## `mecha bot kill`

Immediately kill a bot process (SIGKILL). Keeps data on disk.

```bash
mecha bot kill <name>
```

| Argument | Description |
|----------|-------------|
| `<name>` | bot name |

```bash
mecha bot kill stuck-agent
```

## `mecha bot restart`

Stop and re-spawn a bot from its persisted configuration.

```bash
mecha bot restart <name> [options]
```

| Argument | Description |
|----------|-------------|
| `<name>` | bot name |

| Option | Description | Default |
|--------|-------------|---------|
| `--force` | Force kill instead of graceful stop | `false` |

Reads `config.json` before stopping (fails fast if missing). Without `--force`, checks for active sessions before stopping. Then re-spawns from config with a fresh port.

```bash
mecha bot restart researcher
mecha bot restart researcher --force
```

## `mecha bot stop-all`

Batch stop all running bots with busy-safety checks.

```bash
mecha bot stop-all [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--force` | Bypass busy check entirely | `false` |
| `--idle-only` | Skip busy bots instead of failing | `false` |
| `--dry-run` | Show what would happen without executing | `false` |

By default, the command **fails** on bots with active sessions. Use `--idle-only` to silently skip busy bots, or `--force` to stop all regardless.

```bash
mecha bot stop-all
mecha bot stop-all --idle-only
mecha bot stop-all --force
mecha bot stop-all --dry-run
```

## `mecha bot restart-all`

Batch restart all bots (stop + re-spawn from config).

```bash
mecha bot restart-all [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--force` | Force kill instead of graceful stop, bypass busy check | `false` |
| `--idle-only` | Skip busy bots instead of failing | `false` |
| `--dry-run` | Show what would happen without executing | `false` |

Reads each bot's `config.json` before acting. Fails for bots with missing config.

```bash
mecha bot restart-all
mecha bot restart-all --force
mecha bot restart-all --dry-run
```

## `mecha bot remove`

Stop a bot and delete its entire directory (config, logs, sessions).

```bash
mecha bot remove <name> [options]
```

| Argument | Description |
|----------|-------------|
| `<name>` | bot name |

| Option | Description | Default |
|--------|-------------|---------|
| `--force` | Force kill instead of graceful stop | `false` |

```bash
mecha bot remove old-agent
mecha bot remove stuck-agent --force
```

## `mecha bot ls`

List all bots with state, port, PID, and tags. Displays a tree view grouped by workspace hierarchy.

```bash
mecha bot ls
```

## `mecha bot status`

Show detailed status of a bot including identity fingerprint, auth profile, sandbox mode, parent bot, and exposed capabilities.

```bash
mecha bot status <name>
```

| Argument | Description |
|----------|-------------|
| `<name>` | bot name |

```bash
mecha bot status researcher
mecha bot status researcher --json
```

## `mecha bot logs`

View bot logs (stdout/stderr).

```bash
mecha bot logs <name> [options]
```

| Argument | Description |
|----------|-------------|
| `<name>` | bot name |

| Option | Description |
|--------|-------------|
| `-f, --follow` | Stream logs live |
| `-n, --tail <lines>` | Number of lines to show (must be a positive integer) |

```bash
mecha bot logs researcher
mecha bot logs researcher -f
mecha bot logs researcher -n 50
```

## `mecha bot configure`

Update bot configuration (tags, capabilities, auth profile). Takes effect on next restart.

```bash
mecha bot configure <name> [options]
```

| Argument | Description |
|----------|-------------|
| `<name>` | bot name |

| Option | Description |
|--------|-------------|
| `--tags <tags>` | Comma-separated tags (replaces existing) |
| `--expose <caps>` | Comma-separated capabilities to expose |
| `--auth <profile>` | Auth profile name to use |

```bash
mecha bot configure researcher --tags research,ml,papers
mecha bot configure coder --expose query,read_workspace
mecha bot configure worker --auth mykey
```

## `mecha bot find`

Find bots, optionally filtered by tag.

```bash
mecha bot find [options]
```

| Option | Description |
|--------|-------------|
| `--tag <tag>` | Filter by tag (repeatable, AND logic) |

Multiple `--tag` flags use AND logic.

```bash
mecha bot find
mecha bot find --tag research
mecha bot find --tag code --tag typescript
```

## `mecha bot chat`

Send a message to a bot and stream the response.

```bash
mecha bot chat <name> <message> [options]
```

| Argument | Description |
|----------|-------------|
| `<name>` | bot name |
| `<message>` | Message to send |

| Option | Description |
|--------|-------------|
| `-s, --session <id>` | Resume a specific session |

```bash
mecha bot chat researcher "What files are in my workspace?"
mecha bot chat researcher "Continue where we left off" --session abc123
```

## `mecha bot sessions list`

List all sessions for a bot.

```bash
mecha bot sessions list <name>
```

Alias: `mecha bot sessions ls`

| Argument | Description |
|----------|-------------|
| `<name>` | bot name |

## `mecha bot sessions show`

Show a session transcript.

```bash
mecha bot sessions show <name> <session-id>
```

| Argument | Description |
|----------|-------------|
| `<name>` | bot name |
| `<session-id>` | Session ID |

---

## See Also

- [CLI Reference](./) -- overview and global options
- [Sessions & Chat](/features/sessions) -- session management with `mecha bot sessions` and `mecha bot chat`
