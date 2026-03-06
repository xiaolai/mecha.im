---
title: System Commands
description: CLI reference for mecha daemon lifecycle, auth, TOTP, ACL, sandbox, audit, tools, MCP, and dashboard commands
---

# System Commands

Daemon lifecycle, authentication, TOTP, ACL, sandbox, audit, tools, MCP server, and dashboard commands.

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

---

## See Also

- [CLI Reference](./) -- overview and global options
- [Quick Start](/guide/quickstart) -- first steps with the CLI
- [Configuration](/guide/configuration) -- auth profiles and bot settings
- [Environment Variables](/reference/environment) -- env vars recognized by Mecha
- [Dashboard](/features/dashboard) -- web UI served by `mecha dashboard serve`
