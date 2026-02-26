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

Another CASA or process is using the port. Either:

```bash
# Let Mecha auto-assign a different port
mecha spawn myagent ~/workspace

# Or specify an unused port
mecha spawn myagent ~/workspace --port 7710
```

### "CASA already exists"

A CASA with that name already exists. Remove it first or choose a different name:

```bash
mecha rm myagent --with-state
mecha spawn myagent ~/workspace
```

### Agent stuck in "spawning" state

The health check may have timed out. Check the logs:

```bash
mecha logs myagent --tail 50
```

Common causes:
- Invalid API key or OAuth token
- Claude Code CLI not installed
- Workspace directory doesn't exist

Kill and respawn:

```bash
mecha kill myagent
mecha spawn myagent ~/workspace
```

## Chat Issues

### "Connection refused"

The CASA isn't running:

```bash
mecha status myagent
# If stopped, restart it
mecha spawn myagent ~/workspace
```

### Streaming hangs

The response may be taking a long time. Check the CASA logs for errors:

```bash
mecha logs myagent --follow
```

## Permission Issues

### "Access denied" for mesh queries

Check ACL grants:

```bash
mecha acl show
```

Ensure the source has the right capability granted to the target:

```bash
mecha acl grant source target query
```

### "Unauthorized" on agent server

The API key doesn't match. Verify with:

```bash
mecha agent status
```

## Sandbox Issues

### "Sandbox not available"

The OS sandbox runtime isn't installed:
- **macOS**: `sandbox-exec` should be available by default
- **Linux**: Install `bwrap` (bubblewrap): `apt install bubblewrap`

In `auto` mode, Mecha will warn and continue without sandbox. In `strict` mode, spawn will fail.

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

The meter proxy may not have been running when requests were made. CASAs spawned before `mecha meter start` won't route through the proxy.

Restart CASAs after starting the meter:

```bash
mecha meter start
mecha stop myagent && mecha spawn myagent ~/workspace
```

## Getting Help

If you're stuck:

1. Check logs: `mecha logs <name> --tail 100`
2. Run doctor: `mecha doctor`
3. Check status: `mecha status <name>`
4. Review the [CLI Reference](/reference/cli) for correct syntax
