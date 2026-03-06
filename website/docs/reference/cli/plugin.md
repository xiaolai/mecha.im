---
title: Plugin Commands
description: CLI reference for mecha plugin MCP server management commands
---

# Plugin Commands

All plugin commands live under `mecha plugin`.

## `mecha plugin add`

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

## `mecha plugin rm`

Remove a plugin from the registry.

```bash
mecha plugin rm <name>
```

| Argument | Description |
|----------|-------------|
| `<name>` | Plugin name |

## `mecha plugin ls`

List all registered plugins. Shows name, type, URL/command, and description.

```bash
mecha plugin ls
```

## `mecha plugin status`

Check if a plugin is reachable. For HTTP/SSE plugins, sends a ping request. For stdio plugins, suggests using `plugin test` instead.

```bash
mecha plugin status <name>
```

| Argument | Description |
|----------|-------------|
| `<name>` | Plugin name |

## `mecha plugin test`

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

## See Also

- [CLI Reference](./) -- overview and global options
