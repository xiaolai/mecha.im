# 05 - Mesh Networking

Tests for node registration, discovery, and cross-node communication.

## Prerequisites

- At least 2 machines running mecha daemon with `--host 0.0.0.0`
- Tailscale network connecting all machines
- Machines initialized: `mecha init` on each

## Tests

### Node Management (Single Machine)

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 5.1 | Initialize node | `mecha node init --name my-node` | Node identity created, keys generated | P0 | |
| 5.2 | Node info | `mecha node info` | Shows hostname, IPs, uptime, bot count | P0 | |
| 5.3 | Add remote node | `mecha node add remote-1 100.100.1.9 --port 7660 --api-key <key>` | Node added to registry | P0 | |
| 5.4 | List nodes | `mecha node ls` | Shows registered nodes with health status | P0 | |
| 5.5 | Remove node | `mecha node rm remote-1` | Node removed from registry | P0 | |
| 5.6 | Add duplicate | `mecha node add remote-1 ...` twice | Error: already exists (409) | P1 | |

### Node Health & Connectivity

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 5.7 | Ping remote node | `mecha node ping remote-1` | Shows latency, healthy=true | P0 | |
| 5.8 | Ping unreachable node | Add node with wrong IP, `mecha node ping bad` | Error: connection refused/timeout | P0 | |
| 5.9 | Node health check | `mecha node health` | All nodes checked, shows online/offline | P0 | |
| 5.10 | Node health specific | `mecha node health remote-1` | Single node health report | P1 | |

### Cross-Node Bot Discovery

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 5.11 | List remote bots | `mecha bot ls` (with nodes registered) | Shows local + remote bots | P0 | |
| 5.12 | Remote bot status | `mecha bot status remote-bot@remote-1` | Shows status from remote node | P0 | |
| 5.13 | Find by tag across nodes | `mecha bot find --tag dev` | Finds bots on all nodes matching tag | P1 | |
| 5.14 | Discover via API | `curl http://127.0.0.1:7660/discover` | Lists all discoverable bots | P0 | |

### Node Invite Flow

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 5.15 | Create invite | `mecha node invite` | Prints mecha://invite/... code | P1 | |
| 5.16 | Join with invite | On peer: `mecha node join <code>` | Peer added to both registries | P1 | |
| 5.17 | Expired invite | Wait past expiry, `mecha node join <code>` | Error: invite expired | P2 | |

### Mesh API

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 5.18 | GET /mesh/nodes | `curl http://127.0.0.1:7660/mesh/nodes` (with auth) | All nodes with health + bot counts | P0 | |
| 5.19 | POST /nodes | `curl -X POST .../nodes -d '{"name":"n","host":"x","port":7660,"apiKey":"k"}'` | 200 | P1 | |
| 5.20 | Auto-discovery handshake | `curl -X POST .../discover/handshake -d '{"clusterKey":"...","nodeName":"..."}'` | Accepted or rejected | P2 | |

## Multi-Machine Test Matrix

| Test | linode02 → spark01 | spark01 → mac-mini | mac-mini → linode02 |
|------|-------------------|-------------------|---------------------|
| Node add | | | |
| Node ping | | | |
| Remote bot ls | | | |
| Remote bot status | | | |
| Cross-node query | | | |
