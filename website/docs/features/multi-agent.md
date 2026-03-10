---
title: Multi-Agent Management
description: Organize and operate a fleet of specialized agents with tags, discovery, and group addressing.
---

# Multi-Agent Management

[[toc]]

Mecha is designed for running many agents simultaneously. Tags, discovery, and group addressing let you organize and operate a fleet of specialized agents.

## Core Concepts

### Agents Are Isolated Processes

Each bot runs as a separate sandboxed process with its own:

- **Home directory** — isolated filesystem at `~/.mecha/bots/<name>/`
- **Auth credentials** — per-bot auth profiles (API key or OAuth token)
- **Port** — unique port in the 7700-7799 range (auto-assigned or explicit)
- **Workspace** — project directory the bot operates in
- **Environment** — sanitized env vars with dangerous keys blocked

Bots cannot read each other's files or credentials. Cross-bot communication happens through the mesh API, governed by ACL rules.

### Tags for Organization

Tags are labels for categorizing bots by role, project, or capability:

```bash
# Assign tags at spawn time (comma-separated)
mecha bot spawn analyst ~/data --tags data,ml

# Update tags later (replaces existing)
mecha bot configure analyst --tags data,ml,reporting
```

Tags power three features:

1. **CLI discovery** — `mecha bot find --tag ml` finds all ML agents
2. **Group addressing** — `+ml` targets all agents tagged "ml" in chat
3. **ACL filtering** — control which bots are visible to other bots via discovery

## Fleet Operations

### Spawning Multiple Agents

```bash
# Spawn specialized agents for a project
mecha bot spawn researcher ~/papers --tags research
mecha bot spawn coder ~/project --tags dev,backend
mecha bot spawn reviewer ~/project --tags dev,qa
mecha bot spawn writer ~/docs --tags docs
```

### Discovery

Find agents by tag:

```bash
# All agents tagged "dev"
mecha bot find --tag dev

# Intersection: agents tagged BOTH "dev" AND "backend"
mecha bot find --tag dev --tag backend
```

Discovery is also available programmatically through the mesh — agents can discover other agents and route queries to them.

### Batch Operations

Manage multiple bots at once:

```bash
# Stop all running bots
mecha bot stop-all

# Stop only idle bots (no active sessions)
mecha bot stop-all --idle-only

# Dry run — see which bots would be affected
mecha bot stop-all --dry-run

# Force stop (SIGKILL instead of SIGTERM)
mecha bot stop-all --force

# Restart all bots
mecha bot restart-all
```

### Lifecycle Management

```bash
# Stop gracefully (SIGTERM)
mecha bot stop researcher

# Kill immediately (SIGKILL)
mecha bot kill researcher

# Restart (stop + spawn with same config)
mecha bot restart researcher

# Remove bot and all its data
mecha bot remove researcher --force
```

## Monitoring

### Status and Health

```bash
# Per-bot status
mecha bot status researcher

# System-wide health check
mecha doctor

# Overall system status
mecha status
```

### Logs

```bash
# Last 100 lines
mecha bot logs researcher

# Stream live
mecha bot logs researcher --follow

# Last 50 lines
mecha bot logs researcher --tail 50
```

### Cost Tracking

```bash
# All bots
mecha cost

# Specific bot
mecha cost researcher

# Per-bot budget limits
mecha budget set researcher --daily 5.00
```

## Scheduling

Automate recurring tasks for any bot:

```bash
# Run every hour
mecha schedule add researcher --id check-papers --every 1h \
  --prompt "Check for new papers and summarize the top 3"

# Run every 30 seconds
mecha schedule add monitor --id health-check --every 30s \
  --prompt "Check system health metrics"

# Pause/resume
mecha schedule pause researcher check-papers
mecha schedule resume researcher check-papers
```

See [Scheduling](/features/scheduling) for the full scheduling reference.

## Access Control

Control which bots can interact with each other:

```bash
# Grant bot-to-bot communication
mecha acl grant researcher coder --caps query

# Revoke access
mecha acl revoke researcher coder --caps query
```

See [Permissions](/features/permissions) for ACL capabilities and rules.

## Multi-Machine Fleets

When bots span multiple machines, the mesh network provides transparent routing:

```bash
# Register a remote node
mecha node add server2 192.168.1.50 --api-key mysecret

# Bots on remote nodes appear in local listings
mecha bot ls         # shows local + remote bots
mecha bot find --tag dev  # discovers across all nodes
```

See [Mesh Networking](/features/mesh-networking) and the [Multi-Machine Guide](/guide/multi-machine) for setup details.

## See Also

- [Bot Commands](/reference/cli/bot) — CLI reference for bot lifecycle, chat, and discovery commands
- [@mecha/process](/reference/api/process) — Process lifecycle management API
- [@mecha/service](/reference/api/service) — High-level service layer (botStatus, botFind, botChat)
- [Scheduling](/features/scheduling) — Automated task scheduling
- [Permissions](/features/permissions) — ACL engine and capability model
- [Mesh Networking](/features/mesh-networking) — Cross-machine bot routing
