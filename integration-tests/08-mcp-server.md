# 08 - MCP Server

Tests for the mesh MCP server (used by Claude Code, Codex, external clients).

## Prerequisites

- Mecha daemon running with bots spawned
- MCP server accessible (started with daemon or `mecha mcp serve`)

## Tests

### MCP Transport

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 8.1 | Start stdio transport | `mecha mcp serve --transport stdio` | MCP server responds on stdin/stdout | P0 | |
| 8.2 | Start HTTP transport | `mecha mcp serve --transport http --port 7680` | MCP server on port 7680 | P0 | |
| 8.3 | HTTP with auth | `mecha mcp serve --transport http --host 0.0.0.0 --token my-secret` | Requires Bearer token | P0 | |
| 8.4 | MCP config output | `mecha mcp config` | Prints Claude Desktop JSON config | P1 | |

### Discovery Tools

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 8.5 | mecha_list_bots | Call via MCP client | Lists all bots with status | P0 | |
| 8.6 | mecha_bot_status | `target: "coder"` | Detailed bot info | P0 | |
| 8.7 | mecha_list_nodes | Call via MCP client | Lists mesh nodes | P0 | |
| 8.8 | mecha_discover | `tag: "dev"` | Filtered bot list | P1 | |
| 8.9 | mecha_discover with capability | `capability: "query"` | Only bots exposing query | P1 | |

### Workspace Tools

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 8.10 | mecha_workspace_list | `target: "coder"` | Lists workspace files | P0 | |
| 8.11 | mecha_workspace_read | `target: "coder", path: "README.md"` | File contents | P0 | |
| 8.12 | Workspace path traversal | `path: "../../etc/passwd"` | Error: path outside workspace | P0 | |

### Session & Query Tools

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 8.13 | mecha_list_sessions | `target: "coder"` | Session list | P1 | |
| 8.14 | mecha_get_session | `target: "coder", sessionId: "<id>"` | Session transcript | P1 | |
| 8.15 | mecha_query | `target: "coder", message: "Hello"` | Chat response with sessionId | P0 | |

### Rate Limiting & Audit

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 8.16 | Audit log | `mecha audit log` | Shows MCP tool invocations | P1 | |

## MCP Client Testing

Test with Claude Code directly:
```bash
# Add to Claude Code's MCP config
mecha mcp config

# In Claude Code, use tools:
# mecha_list_bots, mecha_bot_status, mecha_query, etc.
```

Test with curl (HTTP transport):
```bash
# JSON-RPC call
curl -X POST http://127.0.0.1:7680 \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"mecha_list_bots","arguments":{}},"id":1}'
```
