# Multi-Agent Management

Mecha is designed for running many agents simultaneously. Tags, discovery, and group addressing let you organize and operate a fleet of specialized agents.

## Spawning Agents

```bash
# Spawn with a name and workspace
mecha spawn researcher ~/papers

# Spawn with tags
mecha spawn coder ~/project --tag dev --tag backend

# Spawn with specific port
mecha spawn reviewer ~/project --port 7710 --tag dev
```

## Listing Agents

```bash
mecha ls
```

Shows a tree view of all CASAs with state, port, workspace, and tags.

## Discovery

Find agents by tag:

```bash
# All agents tagged "dev"
mecha find --tag dev

# All agents tagged "research"
mecha find --tag research
```

Discovery is also available programmatically through the mesh — agents can discover other agents and route queries to them.

## Tags

Tags are labels for organizing CASAs:

```bash
# Add tags at spawn time
mecha spawn analyst ~/data --tag data --tag ml

# Update tags later
mecha configure analyst --tag data --tag ml --tag reporting
```

Tags power three features:

1. **CLI discovery** — `mecha find --tag ml`
2. **Group addressing** — `+ml` targets all ML agents
3. **ACL filtering** — filter visible CASAs by tag in discovery responses

## Lifecycle Management

```bash
# Stop gracefully (SIGTERM)
mecha stop researcher

# Kill immediately (SIGKILL)
mecha kill researcher

# Restart (stop + start)
mecha restart researcher

# Remove a stopped CASA and its state
mecha rm researcher --with-state

# Remove even if running
mecha rm researcher --force --with-state

# Clean up all stopped CASAs
mecha prune
```

## Logs

```bash
# Last 100 lines
mecha logs researcher

# Stream live
mecha logs researcher --follow

# Last 50 lines
mecha logs researcher --tail 50
```

## Health Monitoring

```bash
# One-time check
mecha status researcher

# Watch mode (polls every 2-10 seconds)
mecha status researcher --watch
```

The `doctor` command checks the overall system health:

```bash
mecha doctor
```
