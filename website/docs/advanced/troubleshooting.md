---
title: Troubleshooting
description: Common issues and solutions for the Mecha runtime.
---

# Troubleshooting

Common issues and how to resolve them.

## System Check

Always start with the doctor:

```bash
mecha doctor
```

This checks Node.js, Claude Code CLI, sandbox support, and directory structure.

## Spawn Issues

### "Port already in use"

Another bot or process is using the port. Either:

```bash
# Let Mecha auto-assign a different port
mecha bot spawn myagent ~/workspace

# Or specify an unused port
mecha bot spawn myagent ~/workspace --port 7710
```

### "bot already exists"

A bot with that name already exists. Stop and kill it first, then respawn:

```bash
mecha bot kill myagent
mecha bot spawn myagent ~/workspace
```

### Agent stuck in "spawning" state

The health check may have timed out. Check the logs:

```bash
mecha bot logs myagent --tail 50
```

Common causes:
- Invalid API key or OAuth token
- Claude Code CLI not installed
- Workspace directory doesn't exist

Kill and respawn:

```bash
mecha bot kill myagent
mecha bot spawn myagent ~/workspace
```

## Chat Issues

### "Connection refused"

The bot isn't running:

```bash
mecha bot status myagent
# If stopped, restart it
mecha bot spawn myagent ~/workspace
```

### Streaming hangs

The response may be taking a long time. Check the bot logs for errors:

```bash
mecha bot logs myagent --follow
```

## Permission Issues

### "Access denied" for mesh queries

Check ACL grants:

```bash
mecha acl show
```

Ensure the source has the right capability granted to the target:

```bash
mecha acl grant source query target
```

## Sandbox Issues

### "Sandbox not available"

The OS sandbox runtime isn't installed:
- **macOS**: `sandbox-exec` should be available by default
- **Linux**: Install `bwrap` (bubblewrap): `apt install bubblewrap`

In `auto` mode, Mecha will warn and continue without sandbox. In `require` mode, spawn will fail.

### Agent can't access workspace files

The sandbox may be restricting access. Check sandbox configuration:

```bash
mecha sandbox show myagent
```

Verify the workspace path is correct and the directory exists.

## Metering Issues

### Meter won't start

Check if the port is in use:

```bash
mecha meter status
```

If a stale proxy.json exists, the meter may think it's already running. Stop and restart:

```bash
mecha meter stop
mecha meter start
```

### Cost shows $0 despite usage

The meter proxy may not have been running when requests were made. bots spawned before `mecha meter start` won't route through the proxy.

Restart bots after starting the meter:

```bash
mecha meter start
mecha bot stop myagent && mecha bot spawn myagent ~/workspace
```

## Getting Help

If you're stuck:

1. Check logs: `mecha bot logs <name> --tail 100`
2. Run doctor: `mecha doctor`
3. Check status: `mecha bot status <name>`
4. Review the [CLI Reference](/reference/cli) for correct syntax
