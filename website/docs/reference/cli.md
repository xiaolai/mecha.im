# CLI Reference

Complete reference for the `mecha` command-line interface.

## Lifecycle

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

### `mecha spawn`

Create and start a new CASA.

```bash
mecha spawn <name> <path> [options]
```

| Option | Description |
|--------|-------------|
| `--port <port>` | Bind to specific port (default: auto-assign 7700-7799) |
| `--tag <tag>` | Add a tag (repeatable) |
| `--anthropic-key <key>` | Anthropic API key |
| `--claude-token <token>` | Claude OAuth token |
| `--otp <secret>` | TOTP secret |
| `--permission-mode <mode>` | `default`, `plan`, or `full-auto` |
| `--show-token` | Print auth token to stdout |

```bash
mecha spawn researcher ~/papers --tag research --tag ml
mecha spawn coder ~/project --permission-mode full-auto --port 7710
```

### `mecha stop`

Gracefully stop a CASA (SIGTERM).

```bash
mecha stop <name>
```

### `mecha kill`

Immediately stop a CASA (SIGKILL).

```bash
mecha kill <name>
```

### `mecha ls`

List all CASAs with state, port, workspace, and tags.

```bash
mecha ls
```

### `mecha status`

Show detailed status of a CASA.

```bash
mecha status <name> [options]
```

| Option | Description |
|--------|-------------|
| `--watch`, `-w` | Poll for updates (2-10 second intervals) |

### `mecha logs`

View CASA logs.

```bash
mecha logs <name> [options]
```

| Option | Description |
|--------|-------------|
| `--follow`, `-f` | Stream logs live |
| `--tail <n>`, `-n <n>` | Number of lines (default: 100) |

### `mecha rm`

Remove a stopped CASA.

```bash
mecha rm <name> [options]
```

| Option | Description |
|--------|-------------|
| `--with-state` | Also remove state data |
| `--force`, `-f` | Force remove even if running |

### `mecha configure`

Update CASA configuration.

```bash
mecha configure <name> [options]
```

| Option | Description |
|--------|-------------|
| `--tag <tag>` | Set tags (repeatable, replaces existing) |
| `--anthropic-key <key>` | Update API key |
| `--claude-token <token>` | Update OAuth token |
| `--permission-mode <mode>` | Change permission mode |

---

## Chat & Sessions

### `mecha chat`

Send a message and stream the response.

```bash
mecha chat <name> <message>
```

```bash
mecha chat researcher "What files are in my workspace?"
```

### `mecha sessions list`

List all sessions for a CASA.

```bash
mecha sessions list <name>
```

### `mecha sessions show`

Show a session transcript.

```bash
mecha sessions show <name> <session-id>
```

---

## Discovery & Tags

### `mecha find`

Find CASAs by tag.

```bash
mecha find --tag <tag>
```

```bash
mecha find --tag research
mecha find --tag dev
```

---

## Permissions (ACL)

### `mecha acl grant`

Grant capabilities from source to target.

```bash
mecha acl grant <source> <target> <capability...>
```

```bash
mecha acl grant coder reviewer query read_workspace
```

### `mecha acl revoke`

Revoke capabilities.

```bash
mecha acl revoke <source> <target> <capability...>
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
mecha node init
```

### `mecha node add`

Register a remote node.

```bash
mecha node add <name> --host <host> --port <port> --api-key <key>
```

### `mecha node ls`

List known nodes.

```bash
mecha node ls
```

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

### `mecha agent status`

Check agent server status.

```bash
mecha agent status
```

---

## Scheduling

### `mecha schedule add`

Add a recurring task.

```bash
mecha schedule add <name> --interval <seconds> --message <prompt>
```

### `mecha schedule list`

List all schedules.

```bash
mecha schedule list
```

### `mecha schedule pause / resume`

```bash
mecha schedule pause <schedule-id>
mecha schedule resume <schedule-id>
```

### `mecha schedule run`

Run a schedule immediately.

```bash
mecha schedule run <schedule-id>
```

### `mecha schedule remove`

```bash
mecha schedule remove <schedule-id>
```

### `mecha schedule history`

View past runs.

```bash
mecha schedule history <schedule-id>
```

---

## Metering & Budgets

### `mecha meter start`

Start the metering proxy.

```bash
mecha meter start [options]
```

| Option | Description |
|--------|-------------|
| `--port <port>` | Proxy port (default: 7800) |
| `--json` | Output connection info as JSON |

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

### `mecha cost show`

Show current spending.

```bash
mecha cost show [options]
```

### `mecha budget set`

Set a spending limit.

```bash
mecha budget set --daily <amount> [--casa <name>]
```

### `mecha budget ls`

List all budgets.

```bash
mecha budget ls
```

### `mecha budget rm`

Remove a budget.

```bash
mecha budget rm --daily [--casa <name>]
```

---

## Auth

### `mecha auth add`

Add a credential profile.

```bash
mecha auth add [options]
```

| Option | Description |
|--------|-------------|
| `--anthropic-key <key>` | API key |
| `--oauth-token <token>` | OAuth token |

### `mecha auth ls`

List profiles.

### `mecha auth default`

Set default profile.

```bash
mecha auth default <name>
```

### `mecha auth switch`

Switch active profile.

```bash
mecha auth switch <name>
```

### `mecha auth test`

Test current credentials.

### `mecha auth renew`

Renew an OAuth token.

```bash
mecha auth renew <name>
```

### `mecha auth rm`

Remove a profile.

```bash
mecha auth rm <name>
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
mecha tools install <name>
```
