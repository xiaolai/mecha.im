# CLI Command Reference

## Global Flags

| Flag | Description |
|------|-------------|
| `--json` | Output in JSON format |
| `--quiet` | Suppress non-essential output |
| `--verbose` | Show detailed output |
| `--no-color` | Disable colored output |

## Lifecycle Commands

### `mecha up <path>`

Create and start a new Mecha from a project directory.

| Option | Description |
|--------|-------------|
| `--port <port>` | Bind to specific host port |
| `--claude-token <token>` | Claude Code OAuth token |
| `--anthropic-key <key>` | Anthropic API key |
| `--otp <secret>` | TOTP secret for browser auth |
| `--permission-mode <mode>` | `default`, `plan`, or `full-auto` |
| `--show-token` | Display auth token after creation |

### `mecha start <id>`

Start a stopped Mecha.

### `mecha stop <id>`

Stop a running Mecha.

### `mecha restart <id>`

Restart a Mecha (stop + start).

### `mecha rm <id>`

Remove a Mecha container.

| Option | Description |
|--------|-------------|
| `--with-state` | Also remove persistent state volume |
| `--force` | Force removal even if running |

### `mecha update <id>`

Pull the latest image and recreate the container.

| Option | Description |
|--------|-------------|
| `--no-pull` | Skip image pull, just recreate |

### `mecha prune`

Remove all stopped Mecha containers.

| Option | Description |
|--------|-------------|
| `--volumes` | Also remove orphaned volumes |
| `--force` | Skip confirmation prompt |

## Inspection Commands

### `mecha ls`

List all Mecha containers with status.

### `mecha status <id>`

Show detailed Mecha status (state, uptime, port, resources).

| Option | Description |
|--------|-------------|
| `--watch` | Live monitoring mode |

### `mecha logs <id>`

Stream container logs.

| Option | Description |
|--------|-------------|
| `--follow` | Follow log output |
| `--tail <lines>` | Number of lines to show |
| `--since <time>` | Show logs since timestamp |

### `mecha inspect <id>`

Show raw Docker container metadata as JSON.

### `mecha env <id>`

Show environment variables of a Mecha.

### `mecha token <id>`

Retrieve the auth token for a running Mecha.

### `mecha ui <id>`

Print the UI URL (with port and auth token).

## Session Commands

### `mecha chat <id> [message]`

Interactive chat with a Mecha. If `message` is provided, sends it and exits. Otherwise enters interactive REPL.

| Option | Description |
|--------|-------------|
| `--session <id>` | Resume existing session |

### `mecha sessions list <id>`

List all sessions for a Mecha.

| Option | Description |
|--------|-------------|
| `--node <name>` | Target a specific mesh node |

### `mecha sessions show <id> <sessionId>`

Show session details with message history.

| Option | Description |
|--------|-------------|
| `--node <name>` | Target a specific mesh node |

### `mecha sessions delete <id> <sessionId>`

Delete a session.

| Option | Description |
|--------|-------------|
| `--node <name>` | Target a specific mesh node |

### `mecha sessions interrupt <id> <sessionId>`

Interrupt an active session.

### `mecha sessions rename <id> <sessionId> <title>`

Rename a session.

| Option | Description |
|--------|-------------|
| `--node <name>` | Target a specific mesh node |

### `mecha sessions config <id> <sessionId>`

Update session configuration.

## Configuration Commands

### `mecha init`

Initialize the mecha environment (Docker network, volumes).

### `mecha configure <id>`

Update runtime config for a running Mecha.

| Option | Description |
|--------|-------------|
| `--claude-token <token>` | Update Claude Code OAuth token |
| `--anthropic-key <key>` | Update Anthropic API key |
| `--otp <secret>` | Update TOTP secret |
| `--permission-mode <mode>` | Update permission mode |

### `mecha eject <id>`

Export Mecha as `docker-compose.yml` + `.env` for standalone use.

| Option | Description |
|--------|-------------|
| `--force` | Overwrite existing files |

### `mecha doctor`

Check system requirements (Docker daemon, network connectivity).

## Execution Commands

### `mecha exec <id> <cmd...>`

Execute a command inside a Mecha container.

## Mesh Commands

### `mecha agent start`

Start the mesh agent server.

| Option | Description |
|--------|-------------|
| `--port <port>` | Listen port (default: 7660) |

### `mecha agent key`

Show or regenerate the agent API key.

### `mecha node add <name> <host>`

Register a remote mesh node.

| Option | Description |
|--------|-------------|
| `--key <apiKey>` | API key for the remote agent |

### `mecha node rm <name>`

Unregister a mesh node.

### `mecha node ls`

List all registered nodes with health status.

### `mecha node check <name>`

Test connectivity to a specific node.

## MCP Commands

### `mecha mcp serve`

Start the mesh MCP server (stdio transport by default).

| Option | Description |
|--------|-------------|
| `--http` | Use HTTP transport instead of stdio |
| `--port <port>` | HTTP port (default: 7670) |

### `mecha mcp config`

Output ready-to-paste MCP config JSON for Claude Desktop / Claude Code.

### `mecha mcp [info] <id>`

Print MCP endpoint URL and token for a specific Mecha.

| Option | Description |
|--------|-------------|
| `--show-token` | Show full auth token (masked by default) |
| `--config` | Output ready-to-paste MCP client config JSON |

## Channel Commands

### `mecha channel add <type>`

Add a new channel gateway (e.g., Telegram bot).

### `mecha channel rm <id>`

Remove a channel gateway.

### `mecha channel ls`

List all channel gateways.

### `mecha channel link <channelId> <mechaId>`

Link a channel to a Mecha (route messages to it).

### `mecha channel unlink <channelId>`

Unlink a channel from its Mecha.

## Utility Commands

### `mecha dashboard`

Launch or open the web dashboard.

### `mecha completions`

Generate shell completion scripts (bash, zsh, fish).
