# 029 - MCP Serve Ignores MECHA_DIR Without Explicit Export

**Severity:** Medium
**Tests affected:** 8.8, 8.9, 8.13, 8.14

## Problem

`mecha mcp serve --transport stdio` does not inherit `MECHA_DIR` unless it is explicitly exported in the shell environment. When run as:

```bash
source .env && MECHA_DIR=$PWD ./mecha mcp serve --transport stdio
```

The MCP tools read from `~/.mecha` (the default) instead of the intended `~/mecha-camp`. This causes `mecha_list_bots` to return stale/wrong data (e.g., par-1 through par-5 from ~/.mecha instead of the actual bots in ~/mecha-camp).

With explicit export it works correctly:

```bash
source .env && export MECHA_DIR=$PWD && ./mecha mcp serve --transport stdio
```

## Root Cause

The inline `MECHA_DIR=$PWD ./mecha mcp serve` syntax sets the variable for the immediate process, but if Bun or the binary forks a subprocess, the non-exported variable may not propagate. This is likely a Bun-compiled binary quirk.

## Impact

Claude Desktop MCP config (from `mecha mcp config`) does not include `MECHA_DIR` in the env block, so users with non-default directories will get wrong bot data from MCP tools.
