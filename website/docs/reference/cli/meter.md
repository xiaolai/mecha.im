---
title: Meter Commands
description: CLI reference for mecha meter proxy and budget management commands
---

# Meter Commands

All meter commands live under `mecha meter`. Budget and cost commands are top-level.

## `mecha meter start`

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

## `mecha meter status`

Show metering proxy status (running/stopped, PID, port, uptime, mode).

```bash
mecha meter status
```

## `mecha meter stop`

Stop the metering proxy. Errors if the proxy is not running.

```bash
mecha meter stop
```

---

## `mecha cost`

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

---

## `mecha budget set`

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

## `mecha budget ls`

List all configured budgets.

```bash
mecha budget ls
```

## `mecha budget rm`

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

## See Also

- [CLI Reference](./) -- overview and global options
- [Metering & Budgets](/features/metering) -- cost tracking with `mecha meter` and `mecha budget`
