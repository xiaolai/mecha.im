# Multi-Agent Management

Mecha is designed for running many agents simultaneously. Tags, discovery, and group addressing let you organize and operate a fleet of specialized agents.

## Spawning Agents

```bash
# Spawn with a name and workspace
mecha spawn researcher ~/papers

# Spawn with tags (comma-separated)
mecha spawn coder ~/project --tags dev,backend

# Spawn with specific port
mecha spawn reviewer ~/project --port 7710 --tags dev
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
# Add tags at spawn time (comma-separated)
mecha spawn analyst ~/data --tags data,ml

# Update tags later (replaces existing)
mecha configure analyst --tags data,ml,reporting
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
# Detailed status
mecha status researcher
```

The `doctor` command checks the overall system health:

```bash
mecha doctor
```
