# 035 - Workspace Read API Returns 404

**Test:** 12.18 - mecha_workspace_read remote
**Machine:** linode02 (100.100.1.9)
**Severity:** P1

## Observed

```
GET /bots/coder/workspace/README.md → {"error":"Not found"}
GET /bots/coder/files?path=README.md → {"home":"...","path":"README.md","entries":[]}
```

The `/workspace/` endpoint returns 404. The `/files` endpoint returns empty entries even though the workspace has files.

## Expected

The API should return the file content for `mecha_workspace_read` MCP tool to work remotely.

## Impact

The `mecha_workspace_read` MCP tool cannot read files from remote bots via the API, breaking cross-node workspace access.
