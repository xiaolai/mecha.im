---
title: CLI Reference
description: Complete command-line reference for the mecha CLI
---

# CLI Reference

[[toc]]

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

## Programmatic API

The CLI is built on [Commander.js](https://github.com/tj/commander.js) with a dependency injection pattern. These internal types and factory functions are exported from `@mecha/cli` for embedding or testing the CLI programmatically.

### `createProgram(deps)`

Creates the root Commander.js program instance with all commands registered and global flags configured.

```ts
import { createProgram } from "@mecha/cli";

const program = createProgram({
  formatter,
  processManager,
  mechaDir: "/Users/you/.mecha",
  acl,
  sandbox,
});

await program.parseAsync(["node", "mecha", "bot", "ls"]);
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `deps` | `CommandDeps` | Dependency injection container (see below) |

**Returns:** `Command` -- a fully configured Commander.js `Command` instance with all subcommands registered.

The program is created with `name("mecha")`, a version read from `package.json`, and the global options listed in [Global Options](#global-options).

### `createFormatter(opts?)`

Creates a CLI output formatter that adapts output based on `--json`, `--quiet`, and `--verbose` flags.

```ts
import { createFormatter } from "@mecha/cli";

// Human-readable output (default)
const fmt = createFormatter();
fmt.success("Bot started successfully");
fmt.table(["Name", "Port"], [["alice", "7700"]]);

// JSON mode
const jsonFmt = createFormatter({ json: true });
jsonFmt.json({ name: "alice", port: 7700 });
// Outputs: { "name": "alice", "port": 7700 }

// Quiet mode (suppresses info/success, only errors)
const quietFmt = createFormatter({ quiet: true });
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `opts` | `FormatterOptions` | `{}` | Formatter configuration (see below) |

**Returns:** `Formatter` -- an object implementing the `Formatter` interface.

**Behavior by mode:**

| Method | Default | `--json` | `--quiet` |
|--------|---------|----------|-----------|
| `success(msg)` | Writes to stdout | Suppressed | Suppressed |
| `error(msg)` | Writes to stderr | Writes `{"error": msg}` to stderr | Writes to stderr |
| `warn(msg)` | Writes to stderr | Suppressed | Writes to stderr |
| `info(msg)` | Writes to stdout | Suppressed | Suppressed |
| `json(data)` | Writes pretty JSON to stdout | Writes pretty JSON to stdout | Writes pretty JSON to stdout |
| `table(headers, rows)` | Writes aligned table to stdout | Writes array of objects to stdout | Suppressed |

### `Formatter` (interface)

The output formatting interface implemented by `createFormatter`. All CLI commands use this interface for consistent output across human-readable, JSON, and quiet modes.

```ts
interface Formatter {
  /** Print a success message to stdout (suppressed in JSON/quiet mode) */
  success(msg: string): void;
  /** Print an error to stderr (in JSON mode, wraps in {"error": msg}) */
  error(msg: string): void;
  /** Print a warning to stderr (suppressed in JSON mode) */
  warn(msg: string): void;
  /** Print an informational message to stdout (suppressed in JSON/quiet mode) */
  info(msg: string): void;
  /** Print structured data as pretty-printed JSON to stdout */
  json(data: unknown): void;
  /** Print a formatted table to stdout (in JSON mode, outputs array of objects) */
  table(headers: string[], rows: string[][]): void;
  /** True when --json flag is active */
  readonly isJson: boolean;
}
```

### `CommandDeps` (type)

Dependency injection container passed to `createProgram` and all command registration functions. Provides shared services that commands need without coupling them to global state.

```ts
interface CommandDeps {
  formatter: Formatter;
  processManager: ProcessManager;
  mechaDir: string;
  acl: AclEngine;
  sandbox: Sandbox;
  registerShutdownHook?: (fn: () => Promise<void>) => void;
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `formatter` | `Formatter` | Yes | Output formatter for human/JSON/quiet modes |
| `processManager` | `ProcessManager` | Yes | Bot process lifecycle manager (from `@mecha/process`) |
| `mechaDir` | `string` | Yes | Path to the mecha configuration directory (e.g., `~/.mecha`) |
| `acl` | `AclEngine` | Yes | Access control engine (from `@mecha/core`) |
| `sandbox` | `Sandbox` | Yes | Sandbox manager (from `@mecha/sandbox`) |
| `registerShutdownHook` | `(fn: () => Promise<void>) => void` | No | Callback to register cleanup functions run on daemon shutdown |

### `FormatterOptions` (type)

Configuration options passed to `createFormatter` to control output behavior.

```ts
interface FormatterOptions {
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  color?: boolean;
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `json` | `boolean` | `false` | Output structured JSON instead of human-readable text |
| `quiet` | `boolean` | `false` | Minimal output -- suppress success and info messages, show errors only |
| `verbose` | `boolean` | `false` | Enable detailed/verbose output |
| `color` | `boolean` | -- | Enable or disable colored output (maps to `--no-color` flag) |

## See Also

- [Quick Start](/guide/quickstart) -- first steps with the CLI
- [Configuration](/guide/configuration) -- auth profiles and bot settings
- [Environment Variables](/reference/environment) -- env vars recognized by Mecha
