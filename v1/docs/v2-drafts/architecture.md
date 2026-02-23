# System Architecture

## Overview

mecha.im is a local-first multi-agent runtime where each **Mecha** is a containerized CASA (Claude Agent SDK App) instance. The system supports multi-node mesh networking via Tailscale, allowing mechas to be discovered and managed across machines.

## Package Dependency Graph

```
                    ┌──────────────┐
                    │  @mecha/cli  │
                    └──────┬───────┘
                           │ depends on
        ┌──────────┬───────┼────────┬──────────┬───────────┐
        ▼          ▼       ▼        ▼          ▼           ▼
   @mecha/     @mecha/  @mecha/  @mecha/   @mecha/    @mecha/
   service     agent    channels docker    mcp-server  contracts
     │           │        │       │          │           │
     ├───────────┤        │       │          │           │
     ▼           ▼        ▼       ▼          ▼           ▼
  @mecha/     @mecha/  @mecha/  @mecha/   @mecha/    @mecha/
  docker      core     docker   (leaf)    service     core
     │                    │                  │
     ▼                    ▼                  ▼
  @mecha/             @mecha/            @mecha/
  core                contracts          docker
     │                    │
     ▼                    ▼
  @mecha/             @mecha/
  contracts           core
```

```
  @mecha/dashboard (Next.js)
     │
     ├── @mecha/service (API routes call service layer)
     ├── @mecha/docker
     ├── @mecha/contracts
     └── @mecha/core

  @mecha/runtime (runs inside each Mecha container)
     │
     ├── @mecha/core
     └── @mecha/contracts
```

## Data Flow

### Local Operation

```
User → CLI/Dashboard → Service Layer → Docker Client → Container
                                           │
                                           ▼
                                    Docker Daemon
                                           │
                                           ▼
                                   Mecha Container
                                   ├── Fastify Server (runtime)
                                   ├── Session Manager (SQLite + JSONL)
                                   ├── MCP Server (per-container)
                                   └── CASA (Claude Agent SDK)
```

### Mesh Operation

```
User → CLI (--node remote) → Service Layer → MechaLocator
                                                  │
                              ┌────────────────────┤
                              ▼                    ▼
                         Local Docker         agentFetch()
                                                  │
                                                  ▼
                                          Remote Agent Server
                                          (port 7660, bearer auth)
                                                  │
                                                  ▼
                                          Remote Docker Daemon
                                                  │
                                                  ▼
                                          Remote Mecha Container
```

### MCP Client Flow

```
Claude Desktop / Claude Code / Cursor
     │
     ▼
  mecha mcp serve (stdio or HTTP)
     │
     ▼
  Mesh MCP Server (@mecha/mcp-server)
     │
     ├── mesh_list_nodes → getNodes() + agentFetch(/healthz)
     ├── mesh_list_mechas → mechaLs() + agentFetch(/mechas)
     ├── mesh_query → MechaLocator → runtimeFetch/agentFetch → SSE
     └── mesh_workspace_* → callContainerMcpTool → per-container MCP
```

## Key Architectural Decisions

### CLI-First Development

Every feature follows: **CLI → Test → GUI**. Business logic lives in `@mecha/service`, shared by both CLI and dashboard. The dashboard is a thin wrapper.

### Dependency Injection

CLI commands receive `CommandDeps` (dockerClient + formatter). Tests mock at the Docker boundary — never mock internal modules.

### Container Isolation

Each Mecha runs in its own Docker container with:
- Read-only root filesystem
- Dropped capabilities (no NET_RAW, SYS_ADMIN, etc.)
- Non-root user (uid 1000)
- Mounted workspace at `/workspace`
- State persistence at `/state`

### Session Persistence

Sessions use a dual-storage model:
- **JSONL transcripts** — append-only message log (source of truth)
- **SQLite metadata** — indexed session list, starred/renamed status

### Authentication

- **Bearer token** — generated at container creation, stored in container env
- **TOTP** — time-based one-time password for browser access
- **Agent API key** — for mesh node-to-node communication

## Port Assignments

| Service | Default Port | Configurable |
|---------|-------------|-------------|
| Mecha container | Docker-assigned | `--port` flag |
| Agent server | 7660 | `--port` flag |
| MCP HTTP server | 7670 | `--port` flag |
| Dashboard | 3457 | Next.js config |
