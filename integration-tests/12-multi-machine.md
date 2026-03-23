# 12 - Multi-Machine

End-to-end tests requiring 2+ machines connected via Tailscale.

## Machine Setup

| Machine | Role | Tailscale IP | Start Command |
|---------|------|-------------|---------------|
| mac-mini-home | Node A | 100.100.1.7 | `mecha start -d --host 0.0.0.0` |
| linode02 | Node B | 100.100.1.9 | `mecha start -d --host 0.0.0.0` |
| spark01 | Node C | 100.100.1.5 | `mecha start -d --host 0.0.0.0` |
| jokershp-wsl | Node D | 100.100.1.4 | `mecha start -d --host 0.0.0.0` (inside WSL) |

## Tests

### Cross-Node Registration

| # | Test | From | To | Expected | P | Result |
|---|------|------|----|----------|---|--------|
| 12.1 | Add node A→B | mac-mini | linode02 | Node registered, ping succeeds | P0 | |
| 12.2 | Add node B→A | linode02 | mac-mini | Bidirectional registration | P0 | |
| 12.3 | Three-node mesh | All | All | Full mesh: A↔B, B↔C, A↔C | P0 | |
| 12.4 | Verify ping latency | Any | Any | `mecha node ping <name>` returns reasonable latency | P0 | |

### Cross-Node Bot Operations

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 12.5 | List remote bots | On A: `mecha bot ls` (with B registered) | Shows bots on both A and B | P0 | |
| 12.6 | Remote bot status | On A: `mecha bot status <bot>@<nodeB>` | Status from node B | P0 | |
| 12.7 | Spawn remote bot (via API) | `curl -X POST http://<nodeB-ip>:7660/bots -d '...'` with API key | Bot spawned on node B | P1 | |
| 12.8 | Stop remote bot | `curl -X POST http://<nodeB-ip>:7660/bots/<name>/stop` | Bot stopped on node B | P1 | |

### Cross-Node Chat & Query

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 12.9 | Chat with remote bot | On A: query bot on B via agent routing | Response from B's bot | P0 | |
| 12.10 | Inter-bot query across nodes | Bot on A queries bot on B | Response routed through agents | P0 | |
| 12.11 | ACL across nodes | Grant `A:alice query B:bob`, verify enforcement | Query allowed with ACL, denied without | P0 | |

### Cross-Node Sessions

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 12.12 | List remote sessions | On A: `curl .../bots/<bot>@<nodeB>/sessions` | Sessions from node B | P1 | |
| 12.13 | View remote session | Get session ID from B, view from A | Transcript visible from A | P1 | |

### Cross-Node Scheduling

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 12.14 | Add schedule to remote bot | On A: schedule add for bot on B | Schedule created on B | P1 | |
| 12.15 | Run remote schedule | On A: trigger schedule on B | Execution result returned | P1 | |

### Cross-Node MCP

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 12.16 | mecha_list_bots across mesh | MCP call from A | Shows bots on all nodes | P0 | |
| 12.17 | mecha_query remote bot | `target: "bot@nodeB"` | Response from B | P0 | |
| 12.18 | mecha_workspace_read remote | `target: "bot@nodeB", path: "README.md"` | File from B's workspace | P1 | |

## Platform Combination Matrix

Test each cross-platform pair to catch architecture-specific bugs:

| Test | macOS→Linux x64 | macOS→Linux arm64 | Linux x64→arm64 | Linux→macOS | WSL→Linux | WSL→macOS | macOS→WSL |
|------|-----------------|-------------------|-----------------|-------------|-----------|-----------|-----------|
| Node ping | | | | | | | |
| Bot ls | | | | | | | |
| Chat query | | | | | | | |
| ACL enforce | | | | | | | |
| Schedule run | | | | | | | |

## Network Failure Scenarios

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| N1 | Node goes offline | Take node B offline mid-operation | Timeout, clear error on A | P0 | |
| N2 | Node comes back | Bring B back, retry operation | Succeeds without re-registration | P0 | |
| N3 | Partial mesh failure | A↔B ok, B↔C broken | A sees B's bots, not C's | P1 | |
