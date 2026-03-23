# 20 - Cross-Node Orchestration

End-to-end tests for distribution features across multiple machines.

## Machine Setup

Same as round 12:

| Machine | Role | Tailscale IP |
|---------|------|-------------|
| mac-mini-home | Node A | 100.100.1.7 |
| linode02 | Node B | 100.100.1.9 |
| spark01 | Node C | 100.100.1.5 |

## Prerequisites

- mecha v0.2.17+ on all machines
- Full mesh registered (all nodes know each other)
- Bots spawned on each machine

## Company Sync

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 20.1 | Company init | On A: `mecha company init` | `~/.mecha/_company/` created as git repo | P0 | |
| 20.2 | Company sync (not implemented) | On A: `mecha company sync` | Shows "not yet implemented" with scp instructions | P0 | |
| 20.3 | Manual company sync | `scp -r ~/.mecha/_company/ joker@100.100.1.5:~/.mecha/_company/` | Company config arrives on spark01 | P0 | |
| 20.4 | Shared company config | Spawn bot on spark01 with `--home ~/.mecha/_company`, write company CLAUDE.md, chat | Bot follows company instructions | P0 | |

## Team Sync

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 20.5 | Team sync (not implemented) | `mecha team sync dev-team` | Shows "not yet implemented" with scp instructions | P0 | |
| 20.6 | Manual workspace sync | scp workspace to remote node | Workspace files arrive correctly | P0 | |

## Bot ls --mesh

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 20.7 | Mesh bot list | On A: `mecha bot ls --mesh` | Shows local + remote bots with node column | P0 | |
| 20.8 | Remote bot count | Spawn 2 bots on B, 1 on C, list from A | Shows correct counts per node | P0 | |

## Cross-Node MCP Tools

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 20.9 | Bus tools available | Spawn bot, check MCP tools list | bus_publish, bus_queue_push, etc. available | P0 | |
| 20.10 | Workflow tools available | Same bot, check tools | workflow_list, workflow_run, workflow_status available | P0 | |
| 20.11 | mesh_query works | Bot uses mesh_query to query a bot on another node | Response from remote bot | P0 | |

## Cross-Node Workflow

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 20.12 | Remote step execution | Create workflow with `bot: "writer@spark01"`, run from mac-mini | Step executes on spark01's writer bot | P1 | |
| 20.13 | Mixed local+remote | Workflow with local step 1 and remote step 2 | Both complete, outputs chain correctly | P1 | |

## Bus Replication

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 20.14 | Replicator setup | Configure topic replication to a remote node | Replicator starts, cursors initialized | P1 | |
| 20.15 | Message forwarding | Publish to replicated topic on A | Message appears on B's topic | P1 | |
| 20.16 | Origin dedup | Message originated from B, replicated to A, should NOT replicate back to B | No loop, message stays on A only | P1 | |

## Signed Identity

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 20.17 | Signed routing | Cross-node mesh_query with both nodes having identities | Request includes x-mecha-signature header | P1 | |
| 20.18 | Signature verification | Check receiving node's log for signature verification | Signature accepted | P1 | |

## Platform Matrix

Test key operations across platform pairs:

| Test | macOS→Linux x64 | macOS→Linux arm64 | Linux x64→arm64 |
|------|-----------------|-------------------|-----------------|
| mesh_query | | | |
| bot ls --mesh | | | |
| Company sync (manual) | | | |
