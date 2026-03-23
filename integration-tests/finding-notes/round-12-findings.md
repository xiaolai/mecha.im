# Round 12 — Multi-Machine / Cross-Node Findings

**Version**: 4.1.4
**Date**: 2026-03-23
**Machine(s)**: mac-mini-home → linode02

## Summary

Cross-node mesh_query partially working. ACL fixes help but agent server lacks cross-node routing.

## Findings

### Finding 1 — Agent /bots/:name/query doesn't route to remote nodes (FEATURE GAP)

- **Symptom**: `mesh_query` with `target: "remote-bot@linode02"` fails with 403
- **Cause**: MCP mesh tool proxies to local agent with `?node=linode02` parameter, but agent server ignores the `node` query param and only looks up local bots
- **Impact**: Cross-node mesh_query via MCP tools doesn't work. Direct `agentFetch` (CLI) works because it routes through the service layer locator.
- **Fix**: Agent server needs mesh routing middleware that, when `?node=` is present, forwards the query to the remote node's agent server using the registered node info + API key.

### Finding 2 — ACL local expose check blocks remote targets (FIXED in v4.1.4)

- **Fix**: Skip expose check for targets with `@node` suffix — remote node enforces its own expose
- **Re-test**: ACL no longer blocks remote targets on the source side

### Note

Cross-node query via CLI (`mecha bot chat remote-bot@linode02`) likely uses `agentFetch` directly (with `createLocator`), which may work independently of the agent server route. The MCP tool path is the one that's broken.
