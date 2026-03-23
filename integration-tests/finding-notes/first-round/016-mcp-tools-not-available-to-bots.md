# 016: Mecha MCP Tools Not Available to Bots by Default

**Test:** 12.16/12.17 - mecha_list_bots / mecha_query across mesh
**Severity:** Medium
**Machine:** spark01 (100.100.1.5)

## Observed

Bots spawned with `mecha bot spawn` do not have access to mecha MCP tools (`mecha_list_bots`, `mecha_query`, etc.) by default. The bot has standard Claude Code tools (Bash, Read, Write, etc.) but no mecha-specific MCP tools.

```
$ mecha bot chat coder "Use the mecha_list_bots tool"
> I don't see a tool called "mecha_list_bots" in my available tools.
```

## Expected

Either:
- Bots should automatically have mecha MCP tools available (the MCP server runs at port 7680)
- Documentation should clearly state that `--mcp-config` is required for cross-mesh MCP operations
- A convenience flag like `--with-mecha-tools` should exist

## Workaround

Spawn bots with explicit MCP config pointing to the local mecha MCP server.

## Impact

Tests 12.16 and 12.17 cannot be verified via bot chat. Cross-mesh MCP operations require explicit MCP configuration that is not documented in the getting-started flow.
