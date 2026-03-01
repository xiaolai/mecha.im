# CLI Reference

Complete reference for the `mecha` command-line interface.

## Global Options

These flags work with any command:

| Option | Description |
|--------|-------------|
| `--json` | Output JSON instead of human-readable format |
| `--quiet` | Minimal output (errors only) |
| `--verbose` | Detailed output |
| `--no-color` | Disable colored output |

---

## Daemon Lifecycle

### `mecha start`

Start the agent server and dashboard as one daemon.

```bash
mecha start [options]
```

| Option | Description |
|--------|-------------|
| `--port <port>` | Agent server port (default: 7660) |
| `--host <host>` | Bind address (default: `127.0.0.1`) |
| `--dashboard-port <port>` | Dashboard port (default: 3457) |
| `--open` | Open browser after starting |

Requires `MECHA_AGENT_API_KEY` environment variable.

```bash
mecha start
mecha start --port 7661 --dashboard-port 3458
mecha start --host 0.0.0.0 --open
```

### `mecha stop`

Stop all running CASAs, meter, and daemon.

```bash
mecha stop [options]
```

| Option | Description |
|--------|-------------|
| `--force` | Force kill CASAs instead of graceful stop |

Gracefully stops all running CASAs (SIGTERM with 5s grace), then stops the meter proxy and daemon. With `--force`, sends SIGKILL immediately.

```bash
mecha stop
mecha stop --force
```

### `mecha restart`

Restart the daemon (stop then start).

```bash
mecha restart [options]
```

| Option | Description |
|--------|-------------|
| `--force` | Force kill CASAs instead of graceful stop |
| `--restart-casas` | Also restart CASAs that were running before stop |

```bash
mecha restart
mecha restart --force
mecha restart --restart-casas
```

### `mecha init`

Initialize the `~/.mecha/` directory structure.

```bash
mecha init
```

### `mecha doctor`

Check system requirements and environment health.

```bash
mecha doctor
```

---

## CASA Management

All CASA commands live under `mecha casa`.

### `mecha casa spawn`

Create and start a new CASA.

```bash
mecha casa spawn <name> <path> [options]
```

| Option | Description |
|--------|-------------|
| `--port <port>`, `-p` | Bind to specific port (default: auto-assign 7700-7799) |
| `--tags <tags>` | Comma-separated tags |
| `--auth <profile>` | Auth profile to use (see `mecha auth ls`) |
| `--no-auth` | Spawn without Claude API credentials |
| `--expose <caps>` | Comma-separated capabilities to expose |
| `--sandbox <mode>` | Sandbox mode: `auto` (default), `off`, `require` |
| `--model <model>` | Model to use |
| `--permission-mode <mode>` | `default`, `plan`, or `full-auto` |
| `--meter <mode>` | Meter mode: `on` (default), `off` |

```bash
mecha casa spawn researcher ~/papers --tags research,ml
mecha casa spawn coder ~/project --permission-mode full-auto --port 7710
```

### `mecha casa start`

Start a stopped CASA from its persisted configuration.

```bash
mecha casa start <name>
```

Re-reads the CASA's `config.json` and spawns a new process from it. Allocates a fresh port. Errors if the CASA is already running or if no config exists.

```bash
mecha casa start researcher
```

### `mecha casa stop`

Gracefully stop a CASA (SIGTERM).

```bash
mecha casa stop <name>
```

### `mecha casa kill`

Immediately stop a CASA (SIGKILL). Keeps data.

```bash
mecha casa kill <name>
```

### `mecha casa restart`

Stop and re-spawn a CASA from its persisted configuration.

```bash
mecha casa restart <name> [options]
```

| Option | Description |
|--------|-------------|
| `--force` | Force kill instead of graceful stop |

Reads `config.json` before stopping (fails fast if missing). Stops the CASA, then re-spawns from config with a fresh port.

```bash
mecha casa restart researcher
mecha casa restart researcher --force
```

### `mecha casa remove`

Stop a CASA and delete its entire directory (config, logs, sessions).

```bash
mecha casa remove <name> [options]
```

| Option | Description |
|--------|-------------|
| `--force` | Force kill instead of graceful stop |

```bash
mecha casa remove old-agent
mecha casa remove stuck-agent --force
```

### `mecha casa ls`

List all CASAs with state, port, workspace, and tags.

```bash
mecha casa ls
```

### `mecha casa status`

Show detailed status of a CASA.

```bash
mecha casa status <name>
```

### `mecha casa logs`

View CASA logs.

```bash
mecha casa logs <name> [options]
```

| Option | Description |
|--------|-------------|
| `--follow`, `-f` | Stream logs live |
| `--tail <n>`, `-n <n>` | Number of lines (default: all) |

### `mecha casa configure`

Update CASA configuration.

```bash
mecha casa configure <name> [options]
```

| Option | Description |
|--------|-------------|
| `--tags <tags>` | Comma-separated tags (replaces existing) |
| `--expose <caps>` | Comma-separated capabilities to expose |
| `--auth <profile>` | Auth profile name to use |

### `mecha casa find`

Find CASAs by tag.

```bash
mecha casa find [--tag <tag>]
```

Multiple `--tag` flags use AND logic.

```bash
mecha casa find --tag research
mecha casa find --tag code --tag typescript
```

### `mecha casa chat`

Send a message and stream the response.

```bash
mecha casa chat <name> <message> [options]
```

| Option | Description |
|--------|-------------|
| `--session <id>`, `-s` | Resume a specific session |

```bash
mecha casa chat researcher "What files are in my workspace?"
mecha casa chat researcher "Continue where we left off" --session abc123
```

### `mecha casa sessions list`

List all sessions for a CASA.

```bash
mecha casa sessions list <name>
```

### `mecha casa sessions show`

Show a session transcript.

```bash
mecha casa sessions show <name> <session-id>
```

---

## Permissions (ACL)

### `mecha acl grant`

Grant a capability from source to target.

```bash
mecha acl grant <source> <capability> <target>
```

```bash
mecha acl grant coder query reviewer
```

### `mecha acl revoke`

Revoke a capability.

```bash
mecha acl revoke <source> <capability> <target>
```

### `mecha acl show`

Show ACL rules.

```bash
mecha acl show [name]
```

---

## Mesh Networking

### `mecha node init`

Generate an Ed25519 identity keypair for this node.

```bash
mecha node init [--name <name>]
```

### `mecha node add`

Register a remote node.

```bash
mecha node add <name> <host> [--port <port>] --api-key <key>
```

### `mecha node invite`

Create a one-time invite code for P2P peer discovery.

```bash
mecha node invite [options]
```

| Option | Description |
|--------|-------------|
| `--expires <duration>` | Invite expiry (default: `24h`). Accepts: `1h`, `6h`, `24h`, `7d` |
| `--server <url>` | Rendezvous server URL (overrides default) |

```bash
mecha node invite
mecha node invite --expires 7d
mecha node invite --server wss://my-rendezvous.example.com
```

The invite code is registered on the rendezvous server (best-effort — works offline too). Share the code with your peer.

### `mecha node join`

Accept an invite and connect to a peer.

```bash
mecha node join <code> [options]
```

| Argument | Description |
|----------|-------------|
| `<code>` | Invite code (`mecha://invite/...`) |

| Option | Description |
|--------|-------------|
| `--force` | Overwrite if peer already in registry |

```bash
mecha node join mecha://invite/eyJ...
mecha node join mecha://invite/eyJ... --force
```

The peer is added as a **managed** node — communication routes through the rendezvous/relay infrastructure instead of direct HTTP.

### `mecha node ls`

List registered peer nodes.

```bash
mecha node ls
```

Displays a table with columns: Name, Type (`managed` or `http`), Host, Port, Added.

### `mecha node ping`

Test connectivity to a peer node.

```bash
mecha node ping <name> [options]
```

| Argument | Description |
|----------|-------------|
| `<name>` | Peer node name |

| Option | Description |
|--------|-------------|
| `--server <url>` | Rendezvous server URL (overrides default) |

```bash
mecha node ping bob
mecha node ping bob --server wss://my-rendezvous.example.com
```

For **managed** nodes, checks online status via the rendezvous server. For **HTTP** nodes, pings the `/healthz` endpoint.

### `mecha node health`

Check health of mesh nodes with latency and CASA count.

```bash
mecha node health [name]
```

| Argument | Description |
|----------|-------------|
| `[name]` | Specific node name (omit for all) |

```bash
# Check all nodes
mecha node health

# Check a specific node
mecha node health bob
```

For **HTTP** nodes, checks `/healthz` and fetches CASA count from `/casas`. For **managed** nodes, checks online status via the rendezvous server.

Output shows: node name, latency in ms, CASA count (if available), and node type (http/managed).

### `mecha node rm`

Remove a remote node.

```bash
mecha node rm <name>
```

### `mecha agent start`

Start the inter-node agent server.

```bash
mecha agent start [options]
```

| Option | Description |
|--------|-------------|
| `--api-key <key>` | Authentication key (or set `MECHA_AGENT_API_KEY`) |
| `--host <host>` | Bind address (default: `127.0.0.1`) |
| `--port <port>` | Port (default: `7660`) |
| `--server` | Enable embedded rendezvous server for decentralized peer discovery |
| `--server-port <port>` | Embedded server port (default: `7681`) |
| `--public-addr <url>` | Externally reachable URL for the embedded server (e.g., `wss://my-server.example.com`) |

### `mecha agent status`

Check agent server status.

```bash
mecha agent status [--port <port>]
```

| Option | Description |
|--------|-------------|
| `--port <port>` | Agent server port (default: `7660`) |

---

## Scheduling

### `mecha schedule add`

Add a recurring task.

```bash
mecha schedule add <casa> --id <id> --every <interval> --prompt <prompt>
```

| Option | Description |
|--------|-------------|
| `--id <id>` | Schedule ID (lowercase, alphanumeric, hyphens) |
| `--every <interval>` | Interval (e.g. `30s`, `5m`, `1h`) |
| `--prompt <prompt>` | Prompt to send on each run |

```bash
mecha schedule add researcher --id check-papers --every 1h --prompt "Check for new papers"
```

### `mecha schedule list`

List all schedules for a CASA.

```bash
mecha schedule list <casa>
```

### `mecha schedule pause / resume`

```bash
mecha schedule pause <casa> [schedule-id]
mecha schedule resume <casa> [schedule-id]
```

Omit `schedule-id` to pause/resume all schedules on a CASA.

### `mecha schedule run`

Run a schedule immediately.

```bash
mecha schedule run <casa> <schedule-id>
```

### `mecha schedule remove`

```bash
mecha schedule remove <casa> <schedule-id>
```

### `mecha schedule history`

View past runs.

```bash
mecha schedule history <casa> <schedule-id> [--limit <n>]
```

| Option | Description |
|--------|-------------|
| `--limit <n>` | Maximum entries to show (default: 20) |

---

## Metering & Budgets

### `mecha meter start`

Start the metering proxy.

```bash
mecha meter start [options]
```

| Option | Description |
|--------|-------------|
| `--port <port>` | Proxy port (default: 7600) |
| `--required` | Fail-closed mode — spawning without metering will fail |

### `mecha meter status`

Check meter proxy status.

```bash
mecha meter status
```

### `mecha meter stop`

Stop the metering proxy.

```bash
mecha meter stop
```

### `mecha cost`

Show current spending.

```bash
mecha cost [casa]
```

Optionally pass a CASA name to show costs for a single agent.

### `mecha budget set`

Set a spending limit.

```bash
mecha budget set [name] --daily <amount> [--monthly <amount>] [options]
```

| Option | Description |
|--------|-------------|
| `--daily <amount>` | Daily spending limit |
| `--monthly <amount>` | Monthly spending limit |
| `--global` | Set as a global budget (omit name) |
| `--auth <profile>` | Set budget for an auth profile (omit name) |
| `--tag <tag>` | Set budget for a tag group (omit name) |

### `mecha budget ls`

List all budgets.

```bash
mecha budget ls
```

### `mecha budget rm`

Remove a budget.

```bash
mecha budget rm [name] --daily [--monthly] [options]
```

| Option | Description |
|--------|-------------|
| `--daily` | Remove daily limit |
| `--monthly` | Remove monthly limit |
| `--global` | Remove global budget (omit name) |
| `--auth <profile>` | Remove budget for an auth profile (omit name) |
| `--tag <tag>` | Remove budget for a tag group (omit name) |

---

## Auth

### `mecha auth add`

Add a credential profile.

```bash
mecha auth add <name> [options]
```

| Option | Description |
|--------|-------------|
| `--api-key` | API key type |
| `--oauth` | OAuth token type |
| `--token <token>` | Token value |
| `--tag <tags...>` | Tags for the profile |

```bash
mecha auth add mykey --api-key --token sk-ant-api03-...
mecha auth add mytoken --oauth --token sk-ant-oat01-...
```

### `mecha auth tag`

Set tags on a profile.

```bash
mecha auth tag <name> <tags...>
```

### `mecha auth ls`

List profiles (shows name, type, account, default, expiry, tags).

### `mecha auth default`

Set default profile.

```bash
mecha auth default <name>
```

### `mecha auth switch`

Switch active profile (global or per-CASA).

```bash
mecha auth switch <name>
mecha auth switch <casa> <profile>
```

### `mecha auth test`

Test credentials (probes API by default).

```bash
mecha auth test <name> [--offline]
```

### `mecha auth renew`

Renew an OAuth token.

```bash
mecha auth renew <name> <token>
```

### `mecha auth rm`

Remove a profile.

```bash
mecha auth rm <name>
```

---

## MCP Server

### `mecha mcp serve`

Start the MCP server. Supports stdio (default, launched by MCP clients) or HTTP transport (for remote clients).

```bash
mecha mcp serve [options]
```

| Option | Description |
|--------|-------------|
| `--mode <mode>` | Operating mode: `query` (default) or `read-only` |
| `--transport <transport>` | Transport: `stdio` (default) or `http` |
| `--port <port>` | HTTP port (default: `7680`) |
| `--host <host>` | HTTP bind address (default: `127.0.0.1`) |
| `--token <token>` | Bearer token for HTTP authentication (required for non-loopback hosts) |

```bash
mecha mcp serve                                   # stdio (default)
mecha mcp serve --transport http                   # HTTP on 127.0.0.1:7680
mecha mcp serve --transport http --port 8080       # HTTP on custom port
mecha mcp serve --transport http --host 0.0.0.0 --token secret  # HTTP on all interfaces (token required)
```

### `mecha mcp config`

Output Claude Desktop configuration JSON for copy-paste into `claude_desktop_config.json`.

```bash
mecha mcp config
```

---

## Audit Log

### `mecha audit log`

View MCP tool call audit entries.

```bash
mecha audit log [options]
```

| Option | Description |
|--------|-------------|
| `--limit <n>` | Show last N entries (default: 50) |

```bash
mecha audit log
mecha audit log --limit 10
mecha audit log --json
```

### `mecha audit clear`

Clear the audit log.

```bash
mecha audit clear
```

---

## Sandbox

### `mecha sandbox show`

Show sandbox details for a CASA.

```bash
mecha sandbox show <name>
```

---

## Tools

### `mecha tools ls`

List installed MCP tools.

```bash
mecha tools ls
```

### `mecha tools install`

Install an MCP tool.

```bash
mecha tools install <name> [options]
```

| Option | Description |
|--------|-------------|
| `--version <version>`, `-v` | Tool version |
| `--description <desc>`, `-d` | Tool description |

---

## Plugins

### `mecha plugin add`

Register a new MCP server plugin.

```bash
mecha plugin add <name> [options]
```

| Option | Description |
|--------|-------------|
| `--url <url>` | MCP endpoint URL (implies type `http`) |
| `--type <type>` | Transport type: `stdio`, `http`, `sse` |
| `--command <cmd>` | Executable command (implies type `stdio`) |
| `--args <args>` | Comma-separated arguments |
| `--env <KEY=VALUE>` | Environment variable (repeatable) |
| `--header <KEY=VALUE>` | HTTP header (repeatable) |
| `-d, --description <text>` | Human-readable description |
| `--force` | Overwrite if plugin already exists |

```bash
mecha plugin add chrome-bridge --url http://127.0.0.1:7890/mcp
mecha plugin add filesystem --command npx --args "-y,@anthropic/mcp-fs,~/docs"
mecha plugin add github --command npx --args "-y,mcp-github" --env "GITHUB_TOKEN=ghp_abc"
```

### `mecha plugin rm`

Remove a plugin from the registry.

```bash
mecha plugin rm <name>
```

### `mecha plugin ls`

List all registered plugins.

```bash
mecha plugin ls
```

### `mecha plugin status`

Check if a plugin is reachable.

```bash
mecha plugin status <name>
```

### `mecha plugin test`

Test plugin connectivity (HTTP) or validate config (stdio).

```bash
mecha plugin test <name>
```

---

## Dashboard

### `mecha dashboard serve`

Start the web dashboard.

```bash
mecha dashboard serve [options]
```

| Option | Description |
|--------|-------------|
| `--port <port>` | Dashboard port (default: 3457) |
| `--host <host>` | Bind address (default: 127.0.0.1) |
| `--open` | Open browser after starting |

The dashboard provides a web UI for managing CASAs, viewing mesh topology, ACL rules, and audit logs. It creates a `ProcessManager` in-process (no separate daemon needed).
