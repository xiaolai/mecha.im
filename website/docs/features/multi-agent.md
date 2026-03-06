---
title: Multi-Agent Management
description: Organize and operate a fleet of specialized agents with tags, discovery, and group addressing.
---

# Multi-Agent Management

Mecha is designed for running many agents simultaneously. Tags, discovery, and group addressing let you organize and operate a fleet of specialized agents.

## Spawning Agents

```bash
# Spawn with a name and workspace
mecha bot spawn researcher ~/papers

# Spawn with tags (comma-separated)
mecha bot spawn coder ~/project --tags dev,backend

# Spawn with specific port
mecha bot spawn reviewer ~/project --port 7710 --tags dev
```

## Listing Agents

```bash
mecha bot ls
```

Shows a tree view of all bots with state, port, workspace, and tags.

## Discovery

Find agents by tag:

```bash
# All agents tagged "dev"
mecha bot find --tag dev

# All agents tagged "research"
mecha bot find --tag research
```

Discovery is also available programmatically through the mesh — agents can discover other agents and route queries to them.

## Tags

Tags are labels for organizing bots:

```bash
# Add tags at spawn time (comma-separated)
mecha bot spawn analyst ~/data --tags data,ml

# Update tags later (replaces existing)
mecha bot configure analyst --tags data,ml,reporting
```

Tags power three features:

1. **CLI discovery** — `mecha bot find --tag ml`
2. **Group addressing** — `+ml` targets all ML agents
3. **ACL filtering** — filter visible bots by tag in discovery responses

## Lifecycle Management

```bash
# Stop gracefully (SIGTERM)
mecha bot stop researcher

# Kill immediately (SIGKILL)
mecha bot kill researcher
```

## Logs

```bash
# Last 100 lines
mecha bot logs researcher

# Stream live
mecha bot logs researcher --follow

# Last 50 lines
mecha bot logs researcher --tail 50
```

## Health Monitoring

```bash
# Detailed status
mecha bot status researcher
```

The `doctor` command checks the overall system health:

```bash
mecha doctor
```

## See Also

- [Bot Commands](/reference/cli/bot) — CLI reference for bot lifecycle, chat, and discovery commands
- [@mecha/process](/reference/api/process) — Process lifecycle management API
- [@mecha/service](/reference/api/service) — High-level service layer (botStatus, botFind, botChat)
