# 027 - MCP Config Outputs Internal Bun Filesystem Path

**Severity:** Medium
**Tests affected:** 8.4

## Problem

`mecha mcp config` outputs the MCP server configuration for Claude Desktop, but the `command` field contains Bun's internal virtual filesystem path instead of the actual binary location:

```json
{
  "mcpServers": {
    "mecha": {
      "command": "/$bunfs/root/mecha",
      "args": ["mcp", "serve"]
    }
  }
}
```

`/$bunfs/root/mecha` is Bun's internal path from `process.execPath` in a compiled binary. The actual binary is at `/usr/local/bin/mecha` or wherever the user installed it.

## Expected

The command should resolve to a real, user-accessible path, e.g.:

```json
{
  "mcpServers": {
    "mecha": {
      "command": "/usr/local/bin/mecha",
      "args": ["mcp", "serve"]
    }
  }
}
```

Use `process.argv[0]` or `which mecha` fallback instead of `process.execPath`.

## Impact

Users copying this config into Claude Desktop will get a broken MCP server because the path does not exist on the real filesystem.
