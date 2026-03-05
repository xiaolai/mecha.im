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

Start the agent server with an embedded dashboard (single process, single port).

```bash
mecha start [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--port <port>` | Agent server port | `7660` |
| `--host <host>` | Bind address | `127.0.0.1` |
| `--open` | Open browser after starting | `false` |
| `--no-totp` | Disable TOTP authentication (for development/testing) | `false` |

The server ensures a TOTP secret exists in `~/.mecha/` and displays a QR code on first run. The SPA dashboard is served from the same port if a built SPA directory is found.

```bash
mecha start
mecha start --port 7661 --host 0.0.0.0
mecha start --open
```

### `mecha stop`

Stop all running bots, meter proxy, and daemon.

```bash
mecha stop [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--force` | Force kill bots (SIGKILL) instead of graceful stop (SIGTERM) | `false` |

Gracefully stops all running bots (SIGTERM), then stops the meter proxy and daemon. With `--force`, sends SIGKILL immediately.

```bash
mecha stop
mecha stop --force
```

### `mecha restart`

Stop all bots and meter daemon, then optionally restart previously-running bots.

```bash
mecha restart [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--force` | Force kill bots instead of graceful stop | `false` |
| `--restart-bots` | Also restart bots that were running before stop | `false` |

When `--restart-bots` is used, the command records which bots were running, stops everything, then re-spawns each from its persisted `config.json`.

```bash
mecha restart
mecha restart --force
mecha restart --restart-bots
```

### `mecha init`

Initialize the `~/.mecha/` directory structure, generate a node ID and keypair.

```bash
mecha init
```

### `mecha doctor`

Run system health checks (directory structure, sandbox availability, etc.).

```bash
mecha doctor
```

---

## bot Management

All bot commands live under `mecha bot`.

### `mecha bot spawn`

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
| `--permission-mode <mode>` | Permission mode: `default`, `plan`, `full-auto` | |
| `--meter <mode>` | Meter mode: `on`, `off` | `on` |

When `[path]` is omitted, CWD defaults to `--home` (or `~/.mecha/<name>/` if `--home` is also omitted). A warning is emitted if CWD is not under HOME.

```bash
mecha bot spawn researcher ~/papers --tags research,ml
mecha bot spawn coder ~/project --permission-mode full-auto --port 7710
mecha bot spawn helper ~/docs --no-auth
mecha bot spawn worker ~/code --meter off
mecha bot spawn alice --home /opt/bots/alice   # HOME and CWD both at /opt/bots/alice
mecha bot spawn alice                           # HOME and CWD both at ~/.mecha/alice/
```

### `mecha bot start`

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

### `mecha bot stop`

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

### `mecha bot kill`

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

### `mecha bot restart`

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

### `mecha bot stop-all`

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

### `mecha bot restart-all`

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

### `mecha bot remove`

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

### `mecha bot ls`

List all bots with state, port, PID, and tags. Displays a tree view grouped by workspace hierarchy.

```bash
mecha bot ls
```

### `mecha bot status`

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

### `mecha bot logs`

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

### `mecha bot configure`

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

### `mecha bot find`

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

### `mecha bot chat`

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

### `mecha bot sessions list`

List all sessions for a bot.

```bash
mecha bot sessions list <name>
```

Alias: `mecha bot sessions ls`

| Argument | Description |
|----------|-------------|
| `<name>` | bot name |

### `mecha bot sessions show`

Show a session transcript.

```bash
mecha bot sessions show <name> <session-id>
```

| Argument | Description |
|----------|-------------|
| `<name>` | bot name |
| `<session-id>` | Session ID |

---

## Permissions (ACL)

### `mecha acl grant`

Grant a capability from source to target. Addresses can be a bot name or `name@node`.

```bash
mecha acl grant <source> <cap> <target>
```

| Argument | Description |
|----------|-------------|
| `<source>` | Source bot name or address (`name@node`) |
| `<cap>` | Capability to grant |
| `<target>` | Target bot name or address (`name@node`) |

```bash
mecha acl grant coder query reviewer
mecha acl grant worker@node1 read_workspace reader@node2
```

### `mecha acl revoke`

Revoke a capability from source to target.

```bash
mecha acl revoke <source> <cap> <target>
```

| Argument | Description |
|----------|-------------|
| `<source>` | Source bot name or address (`name@node`) |
| `<cap>` | Capability to revoke |
| `<target>` | Target bot name or address (`name@node`) |

### `mecha acl show`

Show ACL rules. Optionally filter by a bot name (matches as source or target).

```bash
mecha acl show [name]
```

| Argument | Description |
|----------|-------------|
| `[name]` | Filter by bot name (optional) |

```bash
mecha acl show
mecha acl show coder
```

---

## Agent Server

The agent server handles cross-node communication for mesh networking.

### `mecha agent start`

Start the agent server for cross-node communication.

```bash
mecha agent start [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--port <port>` | Agent server port | `7660` |
| `--host <host>` | Bind address | `127.0.0.1` |
| `--server` | Enable embedded rendezvous + relay server | `false` |
| `--server-port <port>` | Embedded server listen port | `7681` |
| `--public-addr <url>` | Externally reachable address (e.g., `wss://myhost:7681`) | |
| `--rendezvous <url>` | Rendezvous server URL for signaling registration | |
| `--no-totp` | Disable TOTP authentication (for development/testing) | `false` |

```bash
mecha agent start
mecha agent start --port 7661 --host 0.0.0.0
mecha agent start --server --server-port 7681 --public-addr wss://myhost:7681
```

### `mecha agent status`

Check if the agent server is running.

```bash
mecha agent status [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--port <port>` | Agent server port to check | `7660` |

```bash
mecha agent status
mecha agent status --port 7661
```

---

## Mesh Networking

### `mecha node init`

Initialize this machine as a named node, generating an Ed25519 identity keypair.

```bash
mecha node init [options]
```

| Option | Description |
|--------|-------------|
| `--name <name>` | Node name (auto-generated if omitted) |

```bash
mecha node init
mecha node init --name my-server
```

### `mecha node add`

Register a remote peer node via HTTP.

```bash
mecha node add <name> <host> [options]
```

| Argument | Description |
|----------|-------------|
| `<name>` | Peer node name |
| `<host>` | Peer node hostname or IP |

| Option | Description | Default |
|--------|-------------|---------|
| `--port <port>` | Agent server port | `7660` |
| `--api-key <key>` | API key for authentication (required) | |

```bash
mecha node add bob 100.100.1.9 --api-key mysecret
mecha node add server 192.168.1.10 --port 7661 --api-key mysecret
```

### `mecha node rm`

Remove a registered peer node.

```bash
mecha node rm <name>
```

| Argument | Description |
|----------|-------------|
| `<name>` | Peer node name |

### `mecha node ls`

List registered peer nodes.

```bash
mecha node ls
```

Displays a table with columns: Name, Type (`managed`, `http`, `tailscale`, `mdns`), Source (`manual` or `discovered`), Host, Port, Last Seen.

Discovered nodes (found via auto-discovery) appear alongside manually added nodes.

### `mecha node promote`

Promote a discovered node to the manual registry (persistent).

```bash
mecha node promote <name>
```

| Argument | Description |
|----------|-------------|
| `<name>` | Name of the discovered node to promote |

Moves a node from `nodes-discovered.json` to `nodes.json`, making it permanent. Use this when you want a discovered node to persist across restarts even if auto-discovery is disabled.

```bash
mecha node promote bob
```

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

For **managed** nodes, checks online status via the rendezvous server. For **HTTP** nodes, pings the `/healthz` endpoint.

```bash
mecha node ping bob
mecha node ping bob --server wss://my-rendezvous.example.com
```

### `mecha node health`

Check health of mesh nodes with latency and bot count.

```bash
mecha node health [name]
```

| Argument | Description |
|----------|-------------|
| `[name]` | Specific node name (omit for all) |

For **HTTP** nodes, checks `/healthz` and fetches bot count from `/bots`. For **managed** nodes, checks online status via the rendezvous server.

```bash
mecha node health
mecha node health bob
```

### `mecha node info`

Show local node system information (hostname, OS, network IPs, CPU, memory, running bot count).

```bash
mecha node info
```

```bash
mecha node info
mecha node info --json
```

### `mecha node invite`

Create a one-time invite code for P2P peer discovery.

```bash
mecha node invite [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--expires <duration>` | Invite expiry. Accepts: `1h`, `6h`, `24h`, `7d` | `24h` |
| `--server <url>` | Rendezvous server URL (overrides default) | |

The invite code is registered on the rendezvous server (best-effort -- works offline too). Share the code with your peer.

```bash
mecha node invite
mecha node invite --expires 7d
mecha node invite --server wss://my-rendezvous.example.com
```

### `mecha node join`

Accept an invite and connect to a peer.

```bash
mecha node join <code> [options]
```

| Argument | Description |
|----------|-------------|
| `<code>` | Invite code (`mecha://invite/...`) |

| Option | Description | Default |
|--------|-------------|---------|
| `--force` | Overwrite if peer already in registry | `false` |

The peer is added as a **managed** node -- communication routes through the rendezvous/relay infrastructure instead of direct HTTP.

```bash
mecha node join mecha://invite/eyJ...
mecha node join mecha://invite/eyJ... --force
```

---

## Scheduling

### `mecha schedule add`

Add a periodic schedule to a bot.

```bash
mecha schedule add <bot> --id <id> --every <interval> --prompt <prompt>
```

| Argument | Description |
|----------|-------------|
| `<bot>` | bot name |

| Option | Description | Required |
|--------|-------------|----------|
| `--id <id>` | Schedule ID (lowercase, alphanumeric, hyphens) | Yes |
| `--every <interval>` | Interval (e.g. `30s`, `5m`, `1h`) | Yes |
| `--prompt <prompt>` | Prompt to send on each run | Yes |

```bash
mecha schedule add researcher --id check-papers --every 1h --prompt "Check for new papers"
```

### `mecha schedule list`

List all schedules for a bot.

```bash
mecha schedule list <bot>
```

Alias: `mecha schedule ls`

| Argument | Description |
|----------|-------------|
| `<bot>` | bot name |

### `mecha schedule pause`

Pause a schedule (or all schedules on a bot).

```bash
mecha schedule pause <bot> [schedule-id]
```

| Argument | Description |
|----------|-------------|
| `<bot>` | bot name |
| `[schedule-id]` | Schedule ID (omit to pause all) |

### `mecha schedule resume`

Resume a paused schedule (or all schedules on a bot).

```bash
mecha schedule resume <bot> [schedule-id]
```

| Argument | Description |
|----------|-------------|
| `<bot>` | bot name |
| `[schedule-id]` | Schedule ID (omit to resume all) |

### `mecha schedule run`

Trigger a schedule to run immediately.

```bash
mecha schedule run <bot> <schedule-id>
```

| Argument | Description |
|----------|-------------|
| `<bot>` | bot name |
| `<schedule-id>` | Schedule ID to trigger |

### `mecha schedule remove`

Remove a schedule from a bot.

```bash
mecha schedule remove <bot> <schedule-id>
```

Alias: `mecha schedule rm`

| Argument | Description |
|----------|-------------|
| `<bot>` | bot name |
| `<schedule-id>` | Schedule ID to remove |

### `mecha schedule history`

View past runs for a schedule.

```bash
mecha schedule history <bot> <schedule-id> [options]
```

| Argument | Description |
|----------|-------------|
| `<bot>` | bot name |
| `<schedule-id>` | Schedule ID |

| Option | Description | Default |
|--------|-------------|---------|
| `--limit <n>` | Maximum entries to show | `20` |

```bash
mecha schedule history researcher check-papers
mecha schedule history researcher check-papers --limit 5
```

---

## Metering & Budgets

### `mecha meter start`

Start the metering proxy daemon.

```bash
mecha meter start [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-p, --port <number>` | Proxy port | `7600` |
| `--required` | Fail-closed mode -- spawning without metering will fail | `false` |

```bash
mecha meter start
mecha meter start --port 7601
mecha meter start --required
```

### `mecha meter status`

Show metering proxy status (running/stopped, PID, port, uptime, mode).

```bash
mecha meter status
```

### `mecha meter stop`

Stop the metering proxy. Errors if the proxy is not running.

```bash
mecha meter stop
```

### `mecha cost`

Show API cost summary for today (UTC).

```bash
mecha cost [bot]
```

| Argument | Description |
|----------|-------------|
| `[bot]` | bot name (omit for all bots) |

```bash
mecha cost
mecha cost researcher
mecha cost --json
```

### `mecha budget set`

Set a spending limit.

```bash
mecha budget set [name] [options]
```

| Argument | Description |
|----------|-------------|
| `[name]` | bot name (omit with `--global`, `--auth`, or `--tag`) |

| Option | Description |
|--------|-------------|
| `--daily <amount>` | Daily USD limit |
| `--monthly <amount>` | Monthly USD limit |
| `--global` | Set as a global budget (omit name) |
| `--auth <profile>` | Set budget for an auth profile (omit name) |
| `--tag <tag>` | Set budget for a tag group (omit name) |

At least one of `--daily` or `--monthly` is required. Amounts must be positive numbers.

```bash
mecha budget set researcher --daily 5.00
mecha budget set --global --daily 50 --monthly 500
mecha budget set --auth mykey --daily 10
mecha budget set --tag research --monthly 100
```

### `mecha budget ls`

List all configured budgets.

```bash
mecha budget ls
```

### `mecha budget rm`

Remove a budget limit.

```bash
mecha budget rm [name] [options]
```

| Argument | Description |
|----------|-------------|
| `[name]` | bot name (omit with `--global`, `--auth`, or `--tag`) |

| Option | Description |
|--------|-------------|
| `--daily` | Remove daily limit |
| `--monthly` | Remove monthly limit |
| `--global` | Remove global budget (omit name) |
| `--auth <profile>` | Remove budget for an auth profile (omit name) |
| `--tag <tag>` | Remove budget for a tag group (omit name) |

One of `--daily` or `--monthly` is required.

```bash
mecha budget rm researcher --daily
mecha budget rm --global --monthly
```

---

## Auth

### `mecha auth add`

Add a credential profile.

```bash
mecha auth add <name> [options]
```

| Argument | Description |
|----------|-------------|
| `<name>` | Profile name |

| Option | Description |
|--------|-------------|
| `--api-key` | API key type |
| `--oauth` | OAuth token type |
| `--token <token>` | Token value (required) |
| `--tag <tags...>` | Tags for the profile |

Exactly one of `--api-key` or `--oauth` must be specified. If this is the first profile, it is automatically set as the default.

```bash
mecha auth add mykey --api-key --token sk-ant-api03-...
mecha auth add mytoken --oauth --token sk-ant-oat01-...
mecha auth add work --api-key --token sk-... --tag work production
```

### `mecha auth ls`

List auth profiles (shows name, type, account, default, expiry, tags).

```bash
mecha auth ls
```

### `mecha auth default`

Set the default auth profile.

```bash
mecha auth default <name>
```

| Argument | Description |
|----------|-------------|
| `<name>` | Profile name |

### `mecha auth rm`

Remove an auth profile.

```bash
mecha auth rm <name>
```

| Argument | Description |
|----------|-------------|
| `<name>` | Profile name |

### `mecha auth tag`

Set tags on an auth profile.

```bash
mecha auth tag <name> <tags...>
```

| Argument | Description |
|----------|-------------|
| `<name>` | Profile name |
| `<tags...>` | Tags to set |

```bash
mecha auth tag mykey work production
```

### `mecha auth switch`

Switch active auth profile (global default or per-bot).

```bash
# Switch global default
mecha auth switch <name>

# Switch per-bot
mecha auth switch <bot> <profile>
```

| Argument | Description |
|----------|-------------|
| `<name>` | Profile name (global switch) or bot name (per-bot switch) |
| `[profile]` | Profile name (when first arg is bot name) |

```bash
mecha auth switch mykey
mecha auth switch researcher work-key
```

### `mecha auth test`

Test credentials. By default probes the Claude API; use `--offline` for a local-only check.

```bash
mecha auth test <name> [options]
```

| Argument | Description |
|----------|-------------|
| `<name>` | Profile name |

| Option | Description |
|--------|-------------|
| `--offline` | Check token exists without making an API call |

```bash
mecha auth test mykey
mecha auth test mykey --offline
```

### `mecha auth renew`

Renew the token for an auth profile.

```bash
mecha auth renew <name> <token>
```

| Argument | Description |
|----------|-------------|
| `<name>` | Profile name |
| `<token>` | New token value |

```bash
mecha auth renew mytoken sk-ant-oat01-new-value...
```

---

## Auth Config

### `mecha auth-config`

View or update authentication configuration. Without flags, shows current config. With flags, updates settings.

```bash
mecha auth-config [options]
```

| Option | Description |
|--------|-------------|
| `--totp` | Enable TOTP authentication |
| `--no-totp` | Disable TOTP authentication (for development/testing) |

```bash
mecha auth-config
mecha auth-config --totp
mecha auth-config --no-totp
```

---

## TOTP

Top-level TOTP management commands (separate from `mecha dashboard totp`).

### `mecha totp setup`

Generate a new TOTP secret and display a QR code for authenticator app enrollment.

```bash
mecha totp setup [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--force` | Overwrite existing secret | `false` |

```bash
mecha totp setup
mecha totp setup --force
```

### `mecha totp verify`

Verify a TOTP code against the stored secret.

```bash
mecha totp verify <code>
```

| Argument | Description |
|----------|-------------|
| `<code>` | 6-digit TOTP code |

```bash
mecha totp verify 123456
```

### `mecha totp status`

Show whether TOTP is configured.

```bash
mecha totp status
```

---

## MCP Server

### `mecha mcp serve`

Start the mesh MCP server. Supports stdio (default, launched by MCP clients) or HTTP transport (for remote clients).

```bash
mecha mcp serve [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--mode <mode>` | Operating mode: `query` or `read-only` | `query` |
| `--transport <transport>` | Transport: `stdio` or `http` | `stdio` |
| `--port <port>` | HTTP port | `7680` |
| `--host <host>` | HTTP bind address | `127.0.0.1` |
| `--token <token>` | Bearer token for HTTP authentication (required for non-loopback hosts) | |

```bash
mecha mcp serve                                   # stdio (default)
mecha mcp serve --transport http                   # HTTP on 127.0.0.1:7680
mecha mcp serve --transport http --port 8080       # HTTP on custom port
mecha mcp serve --transport http --host 0.0.0.0 --token secret  # HTTP on all interfaces
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

| Option | Description | Default |
|--------|-------------|---------|
| `--limit <n>` | Show last N entries | `50` |

```bash
mecha audit log
mecha audit log --limit 10
mecha audit log --json
```

### `mecha audit clear`

Clear the MCP audit log.

```bash
mecha audit clear
```

---

## Sandbox

### `mecha sandbox show`

Show the sandbox profile for a bot (reads `sandbox-profile.json`).

```bash
mecha sandbox show <name>
```

| Argument | Description |
|----------|-------------|
| `<name>` | bot name |

---

## Tools

### `mecha tools install`

Install a tool.

```bash
mecha tools install <name> [options]
```

| Argument | Description |
|----------|-------------|
| `<name>` | Tool name |

| Option | Description |
|--------|-------------|
| `-v, --version <version>` | Tool version |
| `-d, --description <desc>` | Tool description |

```bash
mecha tools install my-tool --version 1.0.0 --description "My custom tool"
```

### `mecha tools ls`

List installed tools.

```bash
mecha tools ls
```

---

## Plugins

### `mecha plugin add`

Register a new MCP server plugin.

```bash
mecha plugin add <name> [options]
```

| Argument | Description |
|----------|-------------|
| `<name>` | Plugin name (lowercase, alphanumeric, hyphens) |

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

Either `--url` (for http/sse) or `--command` (for stdio) is required. Type is inferred from these flags unless `--type` is explicitly set.

```bash
mecha plugin add chrome-bridge --url http://127.0.0.1:7890/mcp
mecha plugin add filesystem --command npx --args "-y,@anthropic/mcp-fs,~/docs"
mecha plugin add github --command npx --args "-y,mcp-github" --env "GITHUB_TOKEN=ghp_abc"
mecha plugin add my-api --url https://api.example.com/mcp --header "X-API-Key=secret"
```

### `mecha plugin rm`

Remove a plugin from the registry.

```bash
mecha plugin rm <name>
```

| Argument | Description |
|----------|-------------|
| `<name>` | Plugin name |

### `mecha plugin ls`

List all registered plugins. Shows name, type, URL/command, and description.

```bash
mecha plugin ls
```

### `mecha plugin status`

Check if a plugin is reachable. For HTTP/SSE plugins, sends a ping request. For stdio plugins, suggests using `plugin test` instead.

```bash
mecha plugin status <name>
```

| Argument | Description |
|----------|-------------|
| `<name>` | Plugin name |

### `mecha plugin test`

Test plugin connectivity. For HTTP/SSE plugins, sends `initialize` and `tools/list` requests and reports tool count. For stdio plugins, validates environment variables and config.

```bash
mecha plugin test <name>
```

| Argument | Description |
|----------|-------------|
| `<name>` | Plugin name |

```bash
mecha plugin test chrome-bridge
mecha plugin test filesystem
```

---

## Dashboard

### `mecha dashboard serve`

Start the web dashboard as a standalone server (separate from `mecha start`).

```bash
mecha dashboard serve [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--port <port>` | Dashboard port | `7660` |
| `--host <host>` | Bind address | `127.0.0.1` |
| `--open` | Open browser after starting | `false` |
| `--no-totp` | Disable TOTP authentication (for development/testing) | `false` |

The dashboard creates an agent server with the embedded SPA. Requires a built SPA directory (run `pnpm --filter @mecha/spa build` first).

```bash
mecha dashboard serve
mecha dashboard serve --port 7660 --open
mecha dashboard serve --host 0.0.0.0
```

### `mecha dashboard totp setup`

Generate a new TOTP secret for dashboard authentication.

```bash
mecha dashboard totp setup
```

### `mecha dashboard totp verify`

Verify a TOTP code.

```bash
mecha dashboard totp verify <code>
```

| Argument | Description |
|----------|-------------|
| `<code>` | 6-digit TOTP code |
