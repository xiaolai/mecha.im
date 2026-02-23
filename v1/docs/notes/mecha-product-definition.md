# Mecha Product Definition (Draft v0.3, Decision-Locked)

## 1. Status

This draft is now decision-locked for MVP scope. No open product decisions remain.

## 2. Product Summary

`mecha.im` is a local-first multi-agent runtime where each Mecha is a containerized CASA (Claude Agent SDK App) instance.

Each Mecha provides:

- persistent workspace mount
- persistent database and memory
- heartbeat and self-maintenance
- peer communication with other Mecha instances
- MCP server exposure
- browser UI for agent interaction

Primary operator experience:

- one CLI manages many Mecha containers on local Docker (Colima)

## 3. Locked MVP Decisions

1. MVP uses one shared `mecha-hub` (`NATS` + chat gateway).
2. MVP provides both UI surfaces:
   - per-Mecha instance UI
   - unified multi-Mecha dashboard
3. v1 persistence baseline is SQLite + vector plugin.
4. CLI IDs are deterministic and human-friendly from project path.
5. `/workspace` is always writable for CASA in v1.
6. Group chat uses one shared channel interface for humans + Mechas.
7. Group chat history is persistent (durable, queryable).
8. mesh network model is per-Mecha node identity.
9. Auth bootstrap default is pre-seeded credential bundle.
10. API-key auth for Claude/Codex is disabled by default (explicit flag required).
11. Host-installed Codex bridge mode is included in v1 (optional).
12. Root filesystem policy in v1 is strict read-only with explicit writable paths.
13. Mecha runtime is non-root only.

## 4. Product Scope

### 4.1 In Scope (MVP)

1. `mecha` CLI lifecycle:
   - create/start/stop/restart/remove/list/logs/exec
2. Project path mounting into container runtime.
3. Persistent per-Mecha state.
4. CASA runtime with:
   - Claude Agent SDK integration
   - MCP server transport
   - UI surfaces (per-Mecha + unified dashboard)
5. Peer messaging and group chat via shared hub.
6. Heartbeat and self-maintenance loops.

### 4.2 Out of Scope (MVP)

1. Cross-machine cluster manager.
2. Advanced distributed file sync conflict handling.
3. Enterprise RBAC/SSO.
4. Mobile clients.

## 5. Users and Use Cases

1. Solo builder running several specialized CASA workers.
2. AI operator maintaining long-lived coding/research agents.
3. Local team demo environment with collaborating Mechas.

## 6. Architecture Overview

### 6.1 High-Level Flow

1. Host runs `mecha` CLI.
2. CLI manages Docker resources on Colima:
   - one CASA container per Mecha
   - one persistent volume per Mecha
   - shared `mecha-net`
   - required shared `mecha-hub` container
3. User accesses per-Mecha UI and unified dashboard.
4. External tools connect to per-Mecha MCP endpoints.
5. Mechas publish heartbeats/messages via `mecha-hub`.

### 6.2 Components

1. `mecha` CLI
   - lifecycle operations
   - status/log/health surfaces
2. Mecha runtime container
   - CASA runtime
   - MCP exposure
   - local supervisor loop
3. `mecha-hub`
   - NATS messaging
   - chat gateway
4. UI apps
   - per-Mecha interaction UI
   - unified multi-Mecha dashboard

## 7. Naming and Mounting

### 7.1 Deterministic ID Scheme

Resource names:

- Mecha ID: `mx-<slug>-<pathhash>`
- Container: `mecha-<id>`
- Volume: `mecha-state-<id>`
- Network: `mecha-net`

Deterministic rule:

1. Canonicalize project path to absolute path.
2. Compute `slug` from final directory name (kebab-case).
3. Compute stable 6-char base36 `pathhash` from canonical path.
4. Compose ID as `mx-<slug>-<pathhash>`.

Example:

- project path `/home/user/projects/foo/bar`
- ID `mx-bar-k9f31d`
- container `mecha-mx-bar-k9f31d`

### 7.2 Mount Layout

- Host project path -> `/workspace`
- Per-Mecha state volume -> `/var/lib/mecha`

## 8. Technology Stack

### 8.1 Runtime and Repo

- TypeScript end-to-end
- Node.js 20+, pnpm
- Turborepo (or Nx)

### 8.2 CLI

- `commander` or `oclif`
- Docker Engine API (`dockerode`) + shell fallback
- human-readable + JSON output modes

### 8.3 Mecha Runtime

- Fastify
- `@anthropic-ai/claude-agent-sdk`
- MCP via streamable HTTP + optional stdio bridge
- in-process scheduler (`node-cron` or equivalent)

### 8.4 Persistence

- SQLite per Mecha
- SQLite FTS + vector plugin in v1
- state files under `/var/lib/mecha`

### 8.5 UI

- Next.js + assistant-ui
- tool panel integration
- WebSocket + REST transport

## 9. Networking and Collaboration

### 9.1 Peer Communication

- required shared bus via NATS in `mecha-hub`
- peer discovery via registry and heartbeat topics
- hub-backed group chat in assistant-ui

### 9.2 Group Chat Model

- one shared channel interface for humans + Mechas
- persistent chat history (durable, queryable)

### 9.3 mesh network LAN Access

Protocol:

- HTTP/WebSocket over mesh network tailnet
- PeerJS is not used for core service reachability

Identity model:

1. One mesh network identity per Mecha runtime.
2. Per-Mecha ACL policy for access and revocation.
3. `mecha-hub` access also scoped by ACL.

Operational tradeoff:

- stronger isolation and revocation control
- higher node/key management overhead

## 10. Security Model

### 10.1 Container Privilege Controls (Hard Requirement)

1. Mecha runtime never runs as root.
2. Docker `--user` uses non-root `uid:gid` (host-mapped default).
3. `no-new-privileges:true` enabled.
4. `cap-drop=ALL` baseline, add back only by explicit need.
5. `sudo` is not installed in runtime image.
6. Dangerous host mounts denied by policy (`/`, `/etc`, `/var/run/docker.sock`).

### 10.2 Filesystem Controls

1. Root filesystem is strict read-only in v1.
2. Explicit writable paths:
   - `/workspace`
   - `/var/lib/mecha`
   - `/tmp`
3. `/workspace` remains writable by design (CASA freeland).

### 10.3 Service Exposure and Authz

1. UI and MCP bind to localhost by default unless explicitly exposed.
2. Per-Mecha local auth token required.
3. Tool permissions constrained by profiles.
4. Mounted path allowlist enforced.

## 11. Authentication Strategy

### 11.1 Bootstrap Mode

1. Default: pre-seeded credential bundle per Mecha.
2. Interactive login remains fallback/recovery only.

### 11.2 Claude/CASA Auth

1. Primary: `claude setup-token` (subscription-based).
2. `ANTHROPIC_API_KEY` auth path disabled by default.
3. API-key path can be enabled only by explicit operator flag.
4. Claude auth/config persisted in Mecha state volume.

### 11.3 Codex Auth

1. Primary: login-backed credentials with file persistence.
2. `CODEX_HOME` persisted (for example `/var/lib/mecha/codex`).
3. Bootstrap imports pre-provisioned `auth.json` by default.
4. Interactive `codex login` allowed for repair/manual onboarding.
5. `OPENAI_API_KEY` auth path disabled by default.
6. API-key path can be enabled only by explicit operator flag.

### 11.4 Claude Code <-> Codex MCP

Default mode (recommended):

1. Codex installed in same container as Claude Code.
2. MCP wiring via stdio:
   - `claude mcp add codex -- codex mcp-server`

Optional v1 mode:

1. Host-installed Codex bridge mode is supported.
2. In-container mode remains default for isolation/reliability.

## 12. CLI Surface (Draft)

```bash
mecha init
mecha up /absolute/project/path --name researcher
mecha ls
mecha status <id>
mecha logs <id>
mecha ui <id>
mecha mcp <id>
mecha dashboard
mecha stop <id>
mecha rm <id>
mecha chat --channel general
```

`mecha up` defaults:

1. non-root runtime
2. no privilege escalation
3. dropped Linux capabilities
4. writable `/workspace` + `/var/lib/mecha`

## 13. Operations

### 13.1 Heartbeat

Each Mecha emits periodic heartbeat with:

- status
- active task count
- last successful tool call
- memory pressure

### 13.2 Self-Maintenance Jobs

- log rotation
- memory compaction/summarization
- stale task cleanup
- optional snapshot export

## 14. Milestones

### M1: Single Mecha Local

- `mecha up` from project path
- persistent workspace + SQLite/vector state
- per-Mecha UI + MCP endpoint

### M2: Multi-Mecha Operations

- list/status/logs/stop/rm across many Mechas
- unified dashboard with health and heartbeat states

### M3: Collaboration Layer

- required `mecha-hub`
- peer messaging
- persistent shared-channel group chat

### M4: Hardening

- backups/snapshots
- recovery flow
- profile-based security presets

## 15. Next Output

Produce next technical package from this locked baseline:

1. architecture diagram
2. detailed command spec
3. data schema (Mecha state, heartbeat, memory/chat tables)
4. implementation work items
