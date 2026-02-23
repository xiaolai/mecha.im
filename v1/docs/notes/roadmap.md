# Mecha.im Roadmap

## M1: Single Mecha Local (Complete)

Single containerized CASA instance running locally via `mecha up`.

- Monorepo scaffolding (pnpm + Turborepo)
- `@mecha/core` — ID generation, types, errors, constants
- `@mecha/docker` — dockerode abstraction with security defaults
- `@mecha/cli` — 13 subcommands (doctor, init, up, ls, stop, start, restart, rm, status, logs, exec, ui, mcp)
- `@mecha/runtime` — Fastify server, SQLite persistence, MCP transport, Claude Agent SDK integration
- `Dockerfile.mecha-runtime` — multi-stage, non-root, read-only
- `@mecha/ui` — Next.js + assistant-ui chat scaffold
- Coverage enforcement (v8 provider, thresholds)

## M2: Multi-Mecha Local

Run multiple Mechas on one machine with inter-Mecha discovery.

- Multiple concurrent containers on `mecha-net`
- Port allocation and conflict resolution
- Service discovery via Docker DNS on shared network
- `mecha ls` showing multiple instances with status
- Per-Mecha resource isolation and limits

## M3: Hub + Messaging

NATS message bus for Mecha-to-Mecha communication.

- `@mecha/hub` — NATS server integration
- Mecha-to-Mecha chat and event routing
- Shared state coordination
- Chat gateway for cross-Mecha conversations
- Hub health monitoring and management CLI commands

## M4: Remote / Distributed (mesh network Mesh)

Deploy and manage Mechas across machines via mesh network/Tailscale network.

```
Machine A (100.64.0.1)          Machine B (100.64.0.2)
┌─────────────────────┐        ┌─────────────────────┐
│  mecha-net (bridge)  │        │  mecha-net (bridge)  │
│  ┌───────┐ ┌───────┐│        │  ┌───────┐ ┌───────┐│
│  │Mecha 1│ │Mecha 2││        │  │Mecha 3│ │Mecha 4││
│  └───┬───┘ └───┬───┘│        │  └───┬───┘ └───┬───┘│
│      └────┬────┘    │        │      └────┬────┘    │
│        NATS node     │        │        NATS node     │
└──────────┬──────────┘        └──────────┬──────────┘
           │      mesh network mesh          │
           └──────────────────────────────┘
```

- **NATS cluster over mesh network** — each machine runs a NATS node, meshed via mesh network WireGuard IPs (100.x.x.x). NATS supports native clustering.
- **Cross-machine discovery** — Mechas register with the hub instead of relying on Docker DNS (host-local). Any Mecha on any machine can find any other.
- **Transport** — Mecha-to-Mecha communication goes over the mesh network tunnel (already encrypted via WireGuard), no extra TLS layer needed between trusted nodes.
- **`mecha deploy` command** — deploy a Mecha to a remote machine in the mesh network network
- **Remote Mecha management** — status, logs, stop/start across machines
- **Identity** — mesh network handles node identity and NAT traversal; Mecha layer only handles message routing and agent coordination

## M5: Production Hardening

Operational readiness for real workloads.

- Structured logging and observability (metrics, tracing)
- Resource limits and quota enforcement
- Auto-restart policies and health-check recovery
- Backup/restore for Mecha state (SQLite snapshots)
- CI/CD pipeline and release automation
