# Auto-Discovery Protocol Design

**Date:** 2026-03-05
**Branch:** feat/auto-discovery
**Status:** Approved

## Problem

Nodes must be manually registered via `mecha node add <name> <host> --api-key <key>`. When deploying mecha to multiple machines (local LAN, cloud VPS, Tailscale overlay), every node must be told about every other node by hand. This doesn't scale and is error-prone.

## Solution

Nodes automatically find and register each other using two complementary mechanisms:

- **Tailscale API** — `tailscale status --json` provides peer IPs on the same tailnet
- **mDNS** — `_mecha._tcp` service broadcast for LAN-only machines

Both paths converge at an HTTP handshake endpoint that verifies cluster membership via a shared secret (`MECHA_CLUSTER_KEY` in `.env`).

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Network scope | Tailscale + LAN | Covers overlay + local machines |
| Authentication | Shared secret (`MECHA_CLUSTER_KEY`) | Explicit opt-in, simple to deploy via `.env` |
| Scan frequency | Startup + every 60s | Fully hands-free, handles nodes coming/going |
| Storage | Separate `nodes-discovered.json` | Never touches manual `nodes.json` |
| Offline handling | TTL-based expiry | 5min → offline, 1hr → removed |

## Architecture

```
┌─────────────────────────────────────┐
│           Discovery Loop            │
│         (every 60 seconds)          │
├──────────────┬──────────────────────┤
│ Tailscale    │ mDNS                 │
│ Status API   │ _mecha._tcp browse   │
│ → peer IPs   │ → peer IPs + ports   │
└──────┬───────┴──────────┬───────────┘
       │                  │
       ▼                  ▼
┌─────────────────────────────────────┐
│    Candidate List (deduplicated)    │
│    Filter: skip self, skip known    │
└──────────────┬──────────────────────┘
               ▼
┌─────────────────────────────────────┐
│   GET /healthz → is it mecha?      │
│   POST /discover/handshake          │
│   → exchange cluster key + info     │
└──────────────┬──────────────────────┘
               ▼
┌─────────────────────────────────────┐
│   nodes-discovered.json             │
│   (separate from manual nodes.json) │
│   TTL: offline after 5min           │
│         removed after 1 hour        │
└─────────────────────────────────────┘
```

## Discovery Sources

### Tailscale

Run `tailscale status --json`, parse the `Peer` map for online machines. For each peer IP, probe port 7660 (default) with `GET /healthz`. If it returns `{"status":"ok","node":"..."}`, it's a mecha node — proceed to handshake.

### mDNS

Advertise `_mecha._tcp` service on startup with TXT record containing the node name and fingerprint. Browse for peers on the same service. mDNS gives us both IP and port directly. Proceed to handshake for any new peer found.

## Handshake Protocol

New endpoint: `POST /discover/handshake` (public path — no session/Bearer required, cluster key verified in body)

```
→ POST /discover/handshake
{
  "clusterKey": "<MECHA_CLUSTER_KEY>",
  "nodeName": "alice",
  "fingerprint": "abc123...",
  "port": 7660,
  "tailscaleIp": "100.64.200.1",
  "lanIp": "10.0.0.100"
}

← 200 OK
{
  "accepted": true,
  "nodeName": "bob",
  "fingerprint": "def456...",
  "port": 7660,
  "meshApiKey": "<HMAC-derived key for Bearer auth>"
}
```

Both sides verify the cluster key matches their own `MECHA_CLUSTER_KEY`. On success, each side stores the other in `nodes-discovered.json`. The response includes the mesh API key so the discoverer can make authenticated requests.

### Security

- Cluster key is never logged
- Handshake endpoint rate-limits to 10 req/min per IP
- Failed attempts (wrong key) return `403` with no details
- Discovery is **opt-in** — only active when `MECHA_CLUSTER_KEY` is set

## Storage

**File:** `mechaDir/nodes-discovered.json` (separate from `nodes.json`)

```typescript
interface DiscoveredNode {
  name: string;
  host: string;           // best IP (tailscale preferred over lan)
  port: number;
  apiKey: string;          // mesh routing key from handshake
  fingerprint?: string;
  source: "tailscale" | "mdns";
  lastSeen: string;        // ISO timestamp, updated each scan
  addedAt: string;
}
```

### Merge Rules

- `readNodes()` unchanged — reads `nodes.json` only
- New `readDiscoveredNodes()` reads `nodes-discovered.json`
- `GET /mesh/nodes` unions both lists
- Manual entries take priority on name conflicts (manual wins)

## TTL & Cleanup

- Each scan cycle updates `lastSeen` for reachable nodes
- Nodes not seen for **5 minutes** → shown as `offline` in dashboard
- Nodes not seen for **1 hour** → removed from `nodes-discovered.json`
- Cleanup runs as part of the scan loop (no separate timer)

## CLI Integration

```bash
# Enable auto-discovery (set in .env)
MECHA_CLUSTER_KEY=my-secret-cluster-key

# View discovered nodes (shows source label)
mecha node ls

# Promote a discovered node to manual (persistent)
mecha node promote <name>

# Disable discovery — don't set MECHA_CLUSTER_KEY
```

## Affected Components

| Component | Change |
|-----------|--------|
| `packages/core/src/discovered-registry.ts` | NEW — read/write/cleanup `nodes-discovered.json` |
| `packages/core/src/discovery.ts` | NEW — Tailscale scanner, mDNS advertiser/browser |
| `packages/agent/src/routes/discover-handshake.ts` | NEW — `POST /discover/handshake` endpoint |
| `packages/agent/src/server.ts` | Start discovery loop if `MECHA_CLUSTER_KEY` set |
| `packages/agent/src/routes/mesh.ts` | Union manual + discovered nodes |
| `packages/agent/src/auth.ts` | Add `/discover/handshake` to public paths |
| `packages/cli/src/commands/node-promote.ts` | NEW — move discovered → manual |
| `packages/cli/src/commands/node-ls.ts` | Show source label (manual/discovered) |
| `packages/spa/src/components/nodes-view.tsx` | Show source badge on node cards |

## What Doesn't Change

- Manual `node add` / `node rm`
- `node invite` / `node join` (managed nodes)
- Auth system (TOTP, sessions, tickets)
- ACL engine
- `nodes.json` format and behavior
