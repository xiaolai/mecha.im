# Architecture

Technical overview of Mecha's internal architecture.

## Package Structure

Mecha is a TypeScript monorepo with 9 packages:

```
@mecha/core       ← Types, schemas, validation, ACL engine, identity (Ed25519)
@mecha/process    ← ProcessManager: spawn/kill/stop, port allocation, sandbox hooks
@mecha/runtime    ← Fastify server per CASA: sessions, chat SSE, MCP tools
@mecha/service    ← High-level API: casaSpawn, casaChat, casaFind, routing
@mecha/agent      ← Inter-node HTTP server for mesh routing
@mecha/sandbox    ← OS-level isolation: macOS sandbox-exec, Linux bwrap
@mecha/meter      ← Metering proxy: cost tracking, budgets, events
@mecha/cli        ← Commander-based CLI: 40+ commands
@mecha/dashboard  ← Next.js web UI (Phase 7)
```

### Dependency Graph

```
cli → service → process → core
                       → sandbox → core
               → agent → core
        → meter → core
runtime → core
```

## Process Model

Each CASA is a child process of the `mecha` CLI:

```
mecha (parent)
  ├── researcher  (child process: mecha __runtime)
  ├── coder       (child process: mecha __runtime)
  └── reviewer    (child process: mecha __runtime)
```

The single `mecha` binary serves dual duty:
- **CLI mode** — when invoked with commands (`mecha spawn`, `mecha chat`)
- **Runtime mode** — when invoked as `mecha __runtime` (spawned internally as a child process)

This is how the bun single-binary distribution works — no separate runtime binary needed.

## Request Flow

### Chat Request

```
User: mecha chat coder "refactor auth"
  │
  ├── CLI parses arguments
  ├── Reads config.json for port + token
  ├── POST http://localhost:7700/api/sessions
  │     Authorization: Bearer <token>
  │     Body: { message: "refactor auth" }
  │
  ├── Response: SSE stream
  │     data: {"type":"progress","content":"Reading files..."}
  │     data: {"type":"assistant","content":"I'll refactor..."}
  │
  └── CLI prints streamed response to stdout
```

### Mesh Query

```
coder calls mesh_query("analyst@bob", "analyze this data")
  │
  ├── Runtime receives MCP tool call
  ├── Router checks ACL: coder → analyst@bob → query
  ├── Locator resolves "bob" → { host, port, apiKey }
  ├── agentFetch sends HTTP request to bob's agent server
  │     POST http://bob:7660/casas/analyst/query
  │     Authorization: Bearer <bob-api-key>
  │     X-Mecha-Source: coder@alice
  │
  ├── Bob's agent server validates auth + ACL
  ├── Bob forwards query to local "analyst" CASA
  ├── Response flows back
  │
  └── coder receives the response as MCP tool result
```

## Data Storage

All state is plain files — no databases:

| Data | Format | Location |
|------|--------|----------|
| CASA config | JSON | `~/.mecha/<name>/config.json` |
| CASA state | JSON | `~/.mecha/<name>/state.json` |
| Sessions | JSONL + JSON | `~/.mecha/<name>/home/.claude/projects/` |
| Logs | Text | `~/.mecha/<name>/logs/` |
| ACL rules | JSON | `~/.mecha/acl.json` |
| Node registry | JSON | `~/.mecha/nodes.json` |
| Auth profiles | JSON | `~/.mecha/auth/profiles.json` |
| Identity | PEM | `~/.mecha/identity/` |
| Meter events | JSONL | `~/.mecha/meter/events/` |
| Meter snapshot | JSON | `~/.mecha/meter/snapshot.json` |
| Budgets | JSON | `~/.mecha/meter/budgets.json` |

All file writes use atomic tmp+rename to prevent corruption on crash.

## Quality Gates

Every change must pass before merge:

```bash
pnpm test           # 1500+ tests
pnpm test:coverage  # 100% statements, branches, functions, lines
pnpm typecheck      # tsc -b (strict TypeScript)
pnpm build          # clean compilation
```
