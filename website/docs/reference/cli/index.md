---
title: CLI Reference
description: Complete command-line reference for the mecha CLI
---

# CLI Reference

Complete reference for the `mecha` command-line interface. Each command group is documented on its own page.

## Global Options

These flags work with any command:

| Option | Description |
|--------|-------------|
| `-V, --version` | Print the CLI version and exit |
| `-h, --help` | Display help for a command |
| `--json` | Output JSON instead of human-readable format |
| `--quiet` | Minimal output (errors only) |
| `--verbose` | Detailed output |
| `--no-color` | Disable colored output |

## Command Groups

| Command | Description | Page |
|---------|-------------|------|
| `mecha bot` | Bot lifecycle management | [Bot Commands](./bot) |
| `mecha schedule` | Scheduled task management | [Schedule Commands](./schedule) |
| `mecha node` | Mesh networking and peer nodes | [Node Commands](./node) |
| `mecha meter` | Metering proxy and budgets | [Meter Commands](./meter) |
| `mecha plugin` | MCP server plugin management | [Plugin Commands](./plugin) |
| `mecha start/stop/restart` | Daemon lifecycle, auth, TOTP, ACL, sandbox, audit, tools, MCP, dashboard | [System Commands](./system) |

## See Also

- [Quick Start](/guide/quickstart) -- first steps with the CLI
- [Configuration](/guide/configuration) -- auth profiles and bot settings
- [Environment Variables](/reference/environment) -- env vars recognized by Mecha
