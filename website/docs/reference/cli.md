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

The server ensures a TOTP secret exists in `~/.mecha/` and displays a QR code on first run. The SPA dashboard is served from the same port if a built SPA directory is found.

```bash
mecha start
mecha start --port 7661 --host 0.0.0.0
mecha start --open
```

### `mecha stop`

Stop all running CASAs, meter proxy, and daemon.

```bash
mecha stop [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--force` | Force kill CASAs (SIGKILL) instead of graceful stop (SIGTERM) | `false` |

Gracefully stops all running CASAs (SIGTERM), then stops the meter proxy and daemon. With `--force`, sends SIGKILL immediately.

```bash
mecha stop
mecha stop --force
```

### `mecha restart`

Stop all CASAs and meter daemon, then optionally restart previously-running CASAs.

```bash
mecha restart [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--force` | Force kill CASAs instead of graceful stop | `false` |
| `--restart-casas` | Also restart CASAs that were running before stop | `false` |

When `--restart-casas` is used, the command records which CASAs were running, stops everything, then re-spawns each from its persisted `config.json`.

```bash
mecha restart
mecha restart --force
mecha restart --restart-casas
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

## CASA Management

All CASA commands live under `mecha casa`.

### `mecha casa spawn`

Create and start a new CASA process.

```bash
mecha casa spawn <name> <path> [options]
```

| Argument | Description |
|----------|-------------|
| `<name>` | CASA name (lowercase, alphanumeric, hyphens) |
| `<path>` | Workspace directory path |

| Option | Description | Default |
|--------|-------------|---------|
| `-p, --port <number>` | Port to listen on | auto-assign (7700-7799) |
| `--auth <profile>` | Auth profile to use (see `mecha auth ls`) | |
| `--no-auth` | Spawn without Claude API credentials | |
| `--tags <tags>` | Comma-separated tags | |
| `--expose <caps>` | Comma-separated capabilities to expose (`query`, `read_workspace`, `write_workspace`, `execute`, `read_sessions`, `lifecycle`) | |
| `--sandbox <mode>` | Sandbox mode: `auto`, `off`, `require` | `auto` |
| `--model <model>` | Model to use | |
| `--permission-mode <mode>` | Permission mode: `default`, `plan`, `full-auto` | |
| `--meter <mode>` | Meter mode: `on`, `off` | `on` |

```bash
mecha casa spawn researcher ~/papers --tags research,ml
mecha casa spawn coder ~/project --permission-mode full-auto --port 7710
mecha casa spawn helper ~/docs --no-auth
mecha casa spawn worker ~/code --meter off
```

### `mecha casa start`

Start a stopped CASA from its persisted `config.json`.

```bash
mecha casa start <name>
```

| Argument | Description |
|----------|-------------|
| `<name>` | CASA name |

Re-reads the CASA's `config.json` and spawns a new process from it. Allocates a fresh port. Errors if the CASA is already running or if no config exists.

```bash
mecha casa start researcher
```

### `mecha casa stop`

Gracefully stop a CASA (SIGTERM).

```bash
mecha casa stop <name> [options]
```

| Argument | Description |
|----------|-------------|
| `<name>` | CASA name |

| Option | Description | Default |
|--------|-------------|---------|
| `--force` | Stop even if CASA has active sessions | `false` |

Without `--force`, the command checks for active sessions and refuses to stop a busy CASA.

```bash
mecha casa stop researcher
mecha casa stop researcher --force
```

### `mecha casa kill`

Immediately kill a CASA process (SIGKILL). Keeps data on disk.

```bash
mecha casa kill <name>
```

| Argument | Description |
|----------|-------------|
| `<name>` | CASA name |

```bash
mecha casa kill stuck-agent
```

### `mecha casa restart`

Stop and re-spawn a CASA from its persisted configuration.

```bash
mecha casa restart <name> [options]
```

| Argument | Description |
|----------|-------------|
| `<name>` | CASA name |

| Option | Description | Default |
|--------|-------------|---------|
| `--force` | Force kill instead of graceful stop | `false` |

Reads `config.json` before stopping (fails fast if missing). Without `--force`, checks for active sessions before stopping. Then re-spawns from config with a fresh port.

```bash
mecha casa restart researcher
mecha casa restart researcher --force
```

### `mecha casa remove`

Stop a CASA and delete its entire directory (config, logs, sessions).

```bash
mecha casa remove <name> [options]
```

| Argument | Description |
|----------|-------------|
| `<name>` | CASA name |

| Option | Description | Default |
|--------|-------------|---------|
| `--force` | Force kill instead of graceful stop | `false` |

```bash
mecha casa remove old-agent
mecha casa remove stuck-agent --force
```

### `mecha casa ls`

List all CASAs with state, port, PID, and tags. Displays a tree view grouped by workspace hierarchy.

```bash
mecha casa ls
```

### `mecha casa status`

Show detailed status of a CASA including identity fingerprint, auth profile, sandbox mode, parent CASA, and exposed capabilities.

```bash
mecha casa status <name>
```

| Argument | Description |
|----------|-------------|
| `<name>` | CASA name |

```bash
mecha casa status researcher
mecha casa status researcher --json
```

### `mecha casa logs`

View CASA logs (stdout/stderr).

```bash
mecha casa logs <name> [options]
```

| Argument | Description |
|----------|-------------|
| `<name>` | CASA name |

| Option | Description |
|--------|-------------|
| `-f, --follow` | Stream logs live |
| `-n, --tail <lines>` | Number of lines to show (must be a positive integer) |

```bash
mecha casa logs researcher
mecha casa logs researcher -f
mecha casa logs researcher -n 50
```

### `mecha casa configure`

Update CASA configuration (tags, capabilities, auth profile). Takes effect on next restart.

```bash
mecha casa configure <name> [options]
```

| Argument | Description |
|----------|-------------|
| `<name>` | CASA name |

| Option | Description |
|--------|-------------|
| `--tags <tags>` | Comma-separated tags (replaces existing) |
| `--expose <caps>` | Comma-separated capabilities to expose |
| `--auth <profile>` | Auth profile name to use |

```bash
mecha casa configure researcher --tags research,ml,papers
mecha casa configure coder --expose query,read_workspace
mecha casa configure worker --auth mykey
```

### `mecha casa find`

Find CASAs, optionally filtered by tag.

```bash
mecha casa find [options]
```

| Option | Description |
|--------|-------------|
| `--tag <tag>` | Filter by tag (repeatable, AND logic) |

Multiple `--tag` flags use AND logic.

```bash
mecha casa find
mecha casa find --tag research
mecha casa find --tag code --tag typescript
```

### `mecha casa chat`

Send a message to a CASA and stream the response.

```bash
mecha casa chat <name> <message> [options]
```

| Argument | Description |
|----------|-------------|
| `<name>` | CASA name |
| `<message>` | Message to send |

| Option | Description |
|--------|-------------|
| `-s, --session <id>` | Resume a specific session |

```bash
mecha casa chat researcher "What files are in my workspace?"
mecha casa chat researcher "Continue where we left off" --session abc123
```

### `mecha casa sessions list`

List all sessions for a CASA.

```bash
mecha casa sessions list <name>
```

Alias: `mecha casa sessions ls`

| Argument | Description |
|----------|-------------|
| `<name>` | CASA name |

### `mecha casa sessions show`

Show a session transcript.

```bash
mecha casa sessions show <name> <session-id>
```

| Argument | Description |
|----------|-------------|
| `<name>` | CASA name |
| `<session-id>` | Session ID |

---

## Permissions (ACL)

### `mecha acl grant`

Grant a capability from source to target. Addresses can be a CASA name or `name@node`.

```bash
mecha acl grant <source> <cap> <target>
```

| Argument | Description |
|----------|-------------|
| `<source>` | Source CASA name or address (`name@node`) |
| `<cap>` | Capability to grant |
| `<target>` | Target CASA name or address (`name@node`) |

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
| `<source>` | Source CASA name or address (`name@node`) |
| `<cap>` | Capability to revoke |
| `<target>` | Target CASA name or address (`name@node`) |

### `mecha acl show`

Show ACL rules. Optionally filter by a CASA name (matches as source or target).

```bash
mecha acl show [name]
```

| Argument | Description |
|----------|-------------|
| `[name]` | Filter by CASA name (optional) |

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

For **managed** nodes, checks online status via the rendezvous server. For **HTTP** nodes, pings the `/healthz` endpoint.

```bash
mecha node ping bob
mecha node ping bob --server wss://my-rendezvous.example.com
```

### `mecha node health`

Check health of mesh nodes with latency and CASA count.

```bash
mecha node health [name]
```

| Argument | Description |
|----------|-------------|
| `[name]` | Specific node name (omit for all) |

For **HTTP** nodes, checks `/healthz` and fetches CASA count from `/casas`. For **managed** nodes, checks online status via the rendezvous server.

```bash
mecha node health
mecha node health bob
```

### `mecha node info`

Show local node system information (hostname, OS, network IPs, CPU, memory, running CASA count).

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

Add a periodic schedule to a CASA.

```bash
mecha schedule add <casa> --id <id> --every <interval> --prompt <prompt>
```

| Argument | Description |
|----------|-------------|
| `<casa>` | CASA name |

| Option | Description | Required |
|--------|-------------|----------|
| `--id <id>` | Schedule ID (lowercase, alphanumeric, hyphens) | Yes |
| `--every <interval>` | Interval (e.g. `30s`, `5m`, `1h`) | Yes |
| `--prompt <prompt>` | Prompt to send on each run | Yes |

```bash
mecha schedule add researcher --id check-papers --every 1h --prompt "Check for new papers"
```

### `mecha schedule list`

List all schedules for a CASA.

```bash
mecha schedule list <casa>
```

Alias: `mecha schedule ls`

| Argument | Description |
|----------|-------------|
| `<casa>` | CASA name |

### `mecha schedule pause`

Pause a schedule (or all schedules on a CASA).

```bash
mecha schedule pause <casa> [schedule-id]
```

| Argument | Description |
|----------|-------------|
| `<casa>` | CASA name |
| `[schedule-id]` | Schedule ID (omit to pause all) |

### `mecha schedule resume`

Resume a paused schedule (or all schedules on a CASA).

```bash
mecha schedule resume <casa> [schedule-id]
```

| Argument | Description |
|----------|-------------|
| `<casa>` | CASA name |
| `[schedule-id]` | Schedule ID (omit to resume all) |

### `mecha schedule run`

Trigger a schedule to run immediately.

```bash
mecha schedule run <casa> <schedule-id>
```

| Argument | Description |
|----------|-------------|
| `<casa>` | CASA name |
| `<schedule-id>` | Schedule ID to trigger |

### `mecha schedule remove`

Remove a schedule from a CASA.

```bash
mecha schedule remove <casa> <schedule-id>
```

Alias: `mecha schedule rm`

| Argument | Description |
|----------|-------------|
| `<casa>` | CASA name |
| `<schedule-id>` | Schedule ID to remove |

### `mecha schedule history`

View past runs for a schedule.

```bash
mecha schedule history <casa> <schedule-id> [options]
```

| Argument | Description |
|----------|-------------|
| `<casa>` | CASA name |
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
mecha cost [casa]
```

| Argument | Description |
|----------|-------------|
| `[casa]` | CASA name (omit for all CASAs) |

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
| `[name]` | CASA name (omit with `--global`, `--auth`, or `--tag`) |

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
| `[name]` | CASA name (omit with `--global`, `--auth`, or `--tag`) |

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

Switch active auth profile (global default or per-CASA).

```bash
# Switch global default
mecha auth switch <name>

# Switch per-CASA
mecha auth switch <casa> <profile>
```

| Argument | Description |
|----------|-------------|
| `<name>` | Profile name (global switch) or CASA name (per-CASA switch) |
| `[profile]` | Profile name (when first arg is CASA name) |

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

```bash
mecha auth-config
mecha auth-config --totp
```

> **Note**: TOTP cannot currently be disabled. The `--no-totp` option has been removed because the auth system requires TOTP to be enabled.

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

Show the sandbox profile for a CASA (reads `sandbox-profile.json`).

```bash
mecha sandbox show <name>
```

| Argument | Description |
|----------|-------------|
| `<name>` | CASA name |

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
