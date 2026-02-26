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
mecha spawn researcher ~/papers --tags research,ml
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
mecha status <name>
```

### `mecha logs`

View CASA logs.

```bash
mecha logs <name> [options]
```

| Option | Description |
|--------|-------------|
| `--follow`, `-f` | Stream logs live |
| `--tail <n>`, `-n <n>` | Number of lines (default: 100) |

### `mecha configure`

Update CASA configuration.

```bash
mecha configure <name> [options]
```

| Option | Description |
|--------|-------------|
| `--tags <tags>` | Comma-separated tags (replaces existing) |
| `--expose <caps>` | Comma-separated capabilities to expose |
| `--auth <profile>` | Auth profile name to use |

---

## Chat & Sessions

### `mecha chat`

Send a message and stream the response.

```bash
mecha chat <name> <message> [options]
```

| Option | Description |
|--------|-------------|
| `--session <id>`, `-s` | Resume a specific session |

```bash
mecha chat researcher "What files are in my workspace?"
mecha chat researcher "Continue where we left off" --session abc123
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

### `mecha cost show`

Show current spending.

```bash
mecha cost show [casa]
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
