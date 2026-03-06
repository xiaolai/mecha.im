---
title: API Reference
description: Complete API reference for all Mecha packages — route summary, server factory, data storage, and package overview.
---

# API Reference

Complete API reference for all Mecha packages.

## Package Overview

| Package | Description | Reference |
|---------|-------------|-----------|
| `@mecha/core` | Types, schemas, validation, ACL engine, identity, discovery, logging, utilities | [core](./core) |
| `@mecha/process` | ProcessManager: spawn/kill/stop, port allocation, sandbox hooks, schedule store | [process](./process) |
| `@mecha/service` | High-level API: botSpawn, botChat, botFind, routing, node ping | [service](./service) |
| `@mecha/runtime` | Fastify server per bot: sessions, chat SSE, MCP tools, scheduler | [runtime](./runtime) |
| `@mecha/meter` | Metering proxy: cost tracking, budgets, rollups, events | [meter](./meter) |
| `@mecha/connect` | P2P connectivity: Noise IK handshake, SecureChannel, invite codes | [connect](./connect) |
| `@mecha/server` | Rendezvous + relay server + gossip protocol for P2P peer discovery | [server](./server) |

## Agent Server API

The agent server (`@mecha/agent`, port 7660) is the unified HTTP + WebSocket server for dashboard UI, inter-node mesh routing, and terminal access. It is created via `createAgentServer()` from `@mecha/agent`.

All routes except those listed as **Public** require authentication (session cookie or Bearer token).

### Route Summary

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| **Health & Info** |
| `GET` | `/healthz` | Public | Health check |
| `GET` | `/node/info` | Required | Full system telemetry |
| `GET` | `/doctor` | Required | System health diagnostics |
| **Auth** |
| `GET` | `/auth/status` | Public | Available auth methods |
| `POST` | `/auth/login` | Public | TOTP login (per-IP rate-limited) |
| `POST` | `/auth/logout` | Public | Clear session cookie |
| `GET` | `/auth/profiles` | Required | List auth profiles |
| **Bots** |
| `GET` | `/bots` | Required | List all bots |
| `POST` | `/bots` | Required | Spawn a new bot |
| `POST` | `/bots/batch` | Required | Batch stop or restart all bots |
| `GET` | `/bots/:name/status` | Required | Get bot status (enriched) |
| `POST` | `/bots/:name/start` | Required | Start a stopped bot from config |
| `POST` | `/bots/:name/stop` | Required | Graceful stop (supports `force` body param) |
| `POST` | `/bots/:name/restart` | Required | Restart bot (supports `force` body param) |
| `POST` | `/bots/:name/kill` | Required | Force kill |
| `DELETE` | `/bots/:name` | Required | Remove a bot (must be stopped) |
| `PATCH` | `/bots/:name/config` | Required | Update bot config fields, optionally restart |
| `GET` | `/bots/:name/logs` | Required | Read bot stdout/stderr logs |
| `GET` | `/bots/:name/sandbox` | Required | Get bot sandbox profile |
| **Sessions** |
| `GET` | `/bots/:name/sessions` | Required | List bot sessions |
| `GET` | `/bots/:name/sessions/:id` | Required | Get specific session |
| `DELETE` | `/bots/:name/sessions/:id` | Required | Delete a session |
| **Routing** |
| `POST` | `/bots/:name/query` | Required | Forward a mesh query (requires `X-Mecha-Source`) |
| **Schedules** |
| `GET` | `/bots/schedules/overview` | Required | All schedules across all bots |
| `GET` | `/bots/:name/schedules` | Required | List bot schedules |
| `POST` | `/bots/:name/schedules` | Required | Add a schedule |
| `DELETE` | `/bots/:name/schedules/:scheduleId` | Required | Remove a schedule |
| `POST` | `/bots/:name/schedules/:scheduleId/pause` | Required | Pause a schedule |
| `POST` | `/bots/:name/schedules/:scheduleId/resume` | Required | Resume a paused schedule |
| `POST` | `/bots/:name/schedules/:scheduleId/run` | Required | Trigger immediate schedule run |
| `GET` | `/bots/:name/schedules/:scheduleId/history` | Required | Schedule run history (supports `?limit=`) |
| **Discovery** |
| `GET` | `/discover` | Required | Discover bots (filterable by `?tag=` and `?capability=`) |
| `POST` | `/discover/handshake` | Cluster Key | Auto-discovery handshake (conditional on `MECHA_CLUSTER_KEY`) |
| **ACL** |
| `GET` | `/acl` | Required | List ACL rules |
| `POST` | `/acl/grant` | Required | Grant a capability |
| `POST` | `/acl/revoke` | Required | Revoke a capability |
| **Audit** |
| `GET` | `/audit` | Required | Read audit log (supports `?limit=`) |
| `POST` | `/audit/clear` | Required | Clear the audit log |
| **Budgets** |
| `GET` | `/budgets` | Required | List budget limits |
| `POST` | `/budgets` | Required | Set a budget limit |
| `DELETE` | `/budgets/:scope/:name?` | Required | Remove a budget limit |
| **Metering** |
| `GET` | `/meter/cost` | Required | Query metering data (supports `?bot=`) |
| `GET` | `/meter/status` | Required | Meter proxy status |
| `POST` | `/meter/start` | Required | Start the meter proxy |
| `POST` | `/meter/stop` | Required | Stop the meter proxy |
| **Events** |
| `GET` | `/events` | Required | SSE stream for real-time process events |
| `GET` | `/events/log` | Required | Persisted event log (supports `?limit=`) |
| **Mesh Nodes** |
| `GET` | `/mesh/nodes` | Required | List mesh nodes with health status |
| `GET` | `/nodes` | Required | List mesh nodes from registry |
| `POST` | `/nodes` | Required | Add a mesh node |
| `DELETE` | `/nodes/:name` | Required | Remove a mesh node |
| `POST` | `/nodes/:name/ping` | Required | Ping a mesh node |
| `POST` | `/nodes/:name/promote` | Required | Promote a discovered node to managed |
| **Tools** |
| `GET` | `/tools` | Required | List installed tools |
| `POST` | `/tools` | Required | Install a tool |
| `DELETE` | `/tools/:name` | Required | Remove a tool |
| **Plugins** |
| `GET` | `/plugins` | Required | List registered plugins |
| `POST` | `/plugins` | Required | Add a plugin |
| `DELETE` | `/plugins/:name` | Required | Remove a plugin |
| `GET` | `/plugins/:name/status` | Required | Get plugin config (secrets redacted) |
| `POST` | `/plugins/:name/test` | Required | Connectivity test for a plugin |
| **Settings** |
| `GET` | `/settings/runtime` | Required | Runtime port configuration |
| `GET` | `/settings/totp` | Required | TOTP auth status |
| `GET` | `/settings/node` | Required | Node identity and network info |
| `GET` | `/settings/auth-profiles` | Required | Auth profile configuration |
| `GET` | `/settings/network` | Required | Network/proxy settings |
| **WebSocket** |
| `POST` | `/ws/ticket` | Required | Issue a single-use WebSocket ticket |
| `WS` | `/ws/terminal/:name` | Ticket | Terminal WebSocket (PTY attach) |

### `createAgentServer(opts)`

Factory function that creates a fully configured Fastify server with all routes, auth hooks, and optional SPA serving.

```ts
import { createAgentServer } from "@mecha/agent";
import { fetchPublicIp } from "@mecha/core";

const publicIp = await fetchPublicIp();
const app = createAgentServer({
  port: 7660,
  auth: { totpSecret: "BASE32SECRET", sessionTtlHours: 24 },
  processManager,
  acl,
  mechaDir: "/Users/you/.mecha",
  nodeName: "alice",
  startedAt: new Date().toISOString(),
  publicIp,
  ptySpawnFn: spawnPty,   // omit to disable terminal
  spaDir: "/path/to/spa", // omit to disable SPA serving
});

await app.listen({ port: 7660, host: "0.0.0.0" });
```

**`AgentServerOpts`**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `port` | `number` | Yes | Port the server binds to |
| `auth` | `AgentServerAuth` | Yes | Authentication configuration |
| `processManager` | `ProcessManager` | Yes | Process manager for bot lifecycle |
| `acl` | `AclEngine` | Yes | ACL engine for access control checks |
| `mechaDir` | `string` | Yes | Path to `~/.mecha` data directory |
| `nodeName` | `string` | Yes | Name of this node in the mesh |
| `startedAt` | `string` | Yes | ISO timestamp of server start |
| `publicIp` | `string` | No | Cached public IP (fetched at startup via `fetchPublicIp()`) |
| `ptySpawnFn` | `PtySpawnFn` | No | PTY spawn function for terminal WebSocket. Omit to disable terminal |
| `spaDir` | `string` | No | Path to SPA dist directory. When set, serves static SPA files and handles client-side routing fallback |

**`AgentServerAuth`**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `totpSecret` | `string` | — | Base32 TOTP secret. When set, enables session-based TOTP auth |
| `sessionTtlHours` | `number` | `24` | Session cookie TTL in hours |
| `apiKey` | `string` | — | Internal API key for mesh node-to-node routing (Bearer token) |

## Data Storage

All state is plain files — no databases:

| Data | Format | Location |
|------|--------|----------|
| bot config | JSON | `~/.mecha/<name>/config.json` |
| bot state | JSON | `~/.mecha/<name>/state.json` |
| Sessions | JSONL + JSON | `~/.mecha/<name>/.claude/projects/` |
| Logs | Text | `~/.mecha/<name>/logs/` |
| ACL rules | JSON | `~/.mecha/acl.json` |
| Node registry | JSON | `~/.mecha/nodes.json` |
| Embedded server state | JSON | `~/.mecha/server.json` |
| Auth profiles | JSON | `~/.mecha/auth/profiles.json` |
| Identity (Ed25519) | PEM | `~/.mecha/identity/` |
| Noise keys (X25519) | PEM | `~/.mecha/identity/` |
| Meter events | JSONL | `~/.mecha/meter/events/` |
| Meter snapshot | JSON | `~/.mecha/meter/snapshot.json` |
| Budgets | JSON | `~/.mecha/meter/budgets.json` |
| Plugin registry | JSON | `~/.mecha/plugins.json` |
| Audit log | JSONL | `~/.mecha/audit.jsonl` |
| Schedule config | JSON | `~/.mecha/<name>/schedule.json` |
| Schedule state | JSON | `~/.mecha/<name>/schedules/<id>/state.json` |
| Schedule history | JSONL | `~/.mecha/<name>/schedules/<id>/history.jsonl` |

All file writes use atomic tmp+rename to prevent corruption on crash.

## See also

- [CLI Reference](/reference/cli/) — Command-line interface documentation
- [Error Reference](/reference/errors) — Error classes and codes
- [Core API](/reference/api/core) — Core library functions and types
