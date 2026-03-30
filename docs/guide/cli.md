---
title: CLI Reference
description: Every mecha command with examples and output.
---

# CLI Reference

## mecha version

Print the version.

```bash
$ mecha version
mecha v0.5.2
```

## mecha worker add

Add a worker from a YAML file or directory.

```bash
# Single file
$ mecha worker add workers/reviewer.yml
added reviewer (managed)

# Directory (adds all .yml/.yaml files)
$ mecha worker add workers/
added reviewer (managed)
added coder (managed)
added api-service (live)
```

If a worker with the same name already exists, the command fails. When adding a directory, all workers are validated before any are added — no partial batch.

## mecha worker remove

Remove a worker definition.

```bash
$ mecha worker remove reviewer
removed reviewer
```

For managed workers, `remove` first stops and deletes the Docker container (even if the worker is still online), then removes the registry entry.

## mecha worker start

Start a worker. Transitions from offline to online.

```bash
# Managed worker (Docker)
$ mecha worker start reviewer
creating container for reviewer...
started reviewer (container)

# Unmanaged worker
$ mecha worker start api-service
started api-service
```

**Managed workers**: mecha creates a Docker container, injects env vars and tokens, starts it, and waits for `GET /health` to return 200. If health doesn't pass within 30 seconds, the container is stopped and removed.

**Unmanaged workers**: mecha marks the worker online and probes its endpoint. If the health check fails, the worker transitions to error state with a warning.

## mecha worker stop

Stop a worker. Transitions from online (or error) to offline.

```bash
# Managed worker
$ mecha worker stop reviewer
stopped reviewer (container)

# Unmanaged worker
$ mecha worker stop api-service
stopped api-service
```

For managed workers, the Docker container is stopped but not removed (persistent lifecycle). It can be started again.

## mecha worker ls

List all registered workers with state and health.

```bash
$ mecha worker ls
NAME          TYPE     STATE   ENDPOINT                HEALTH
reviewer      managed  online  http://127.0.0.1:32768  ok
coder         managed  offline -                       -
api-service   live     error   http://100.64.0.3:8080  unreachable
```

| Column | Description |
|--------|-------------|
| NAME | Worker name from YAML |
| TYPE | `managed` (Docker) or `live` (unmanaged) |
| STATE | `offline`, `online`, or `error` |
| ENDPOINT | Runtime URL (managed: auto-assigned port, live: from YAML) |
| HEALTH | `ok`, `unreachable`, `-` (offline), or error message |

Health is probed concurrently for online workers. Workers in `error` state show their stored error message without a live probe. Offline workers show `-`.

## mecha config

Show resolved worker configuration as YAML.

```bash
# Single worker
$ mecha config reviewer
name: reviewer
docker:
  image: mecha-worker-claude:latest
  lifecycle: persistent
  env:
    CLAUDE_MODEL: claude-sonnet-4-6
  token: claude.xiaolaidev
timeout: 30m0s

# All workers
$ mecha config
name: reviewer
...
---
name: coder
...
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `MECHA_REGISTRY_PATH` | Override registry file location (default: `~/.mecha/registry.json`) |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Error (invalid args, worker not found, Docker failure, etc.) |
