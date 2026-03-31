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

For Docker workers, `remove` first stops and deletes the container, then removes the registry entry. For SSH workers, `remove` kills the tunnel and remote process if still running. Unmanaged and adapter workers must be stopped (`worker stop`) before removal.

## mecha worker start

Start a worker. Transitions from offline to online.

```bash
# Docker worker
$ mecha worker start reviewer
creating container for reviewer...
started reviewer (container)

# SSH worker (oneshot)
$ mecha worker start ssh-reviewer
connecting to joker@mac-mini-home...
checking claude cli on mac-mini-home...
started ssh-reviewer (ssh/oneshot)

# SSH worker (interactive)
$ mecha worker start ssh-coder
connecting to joker@mac-mini-home...
checking claude cli on mac-mini-home...
starting runtime server on mac-mini-home...
tunnel mac-mini-home:8081 -> localhost:49152 (pid 12345)
started ssh-coder (ssh/interactive)

# Unmanaged worker
$ mecha worker start api-service
started api-service
```

**Docker workers**: mecha creates a Docker container, injects env vars and tokens, starts it, and waits for `GET /health` to return 200. If health doesn't pass within 30 seconds, the container is stopped and removed.

**SSH workers (oneshot)**: mecha validates SSH connectivity and checks that `claude` CLI is installed on the remote host. No persistent process — each task runs `claude -p` via a fresh SSH connection.

**SSH workers (interactive)**: mecha starts a runtime server on the remote host, creates an SSH tunnel back, and waits for health. The tunnel PID is persisted so `stop` works from any CLI invocation.

**Unmanaged workers**: mecha marks the worker online and probes its endpoint. If the health check fails, the worker transitions to error state with a warning.

## mecha worker stop

Stop a worker. Transitions from online (or error) to offline.

```bash
# Docker worker
$ mecha worker stop reviewer
stopped reviewer (container)

# SSH worker
$ mecha worker stop ssh-reviewer
stopped ssh-reviewer (ssh)

# Unmanaged worker
$ mecha worker stop api-service
stopped api-service
```

For Docker workers, the container is stopped but not removed (persistent lifecycle). For SSH interactive workers, the remote server process is killed and the SSH tunnel is torn down. Oneshot SSH workers have no persistent process to stop.

## mecha worker ls

List all registered workers with state and health.

```bash
$ mecha worker ls
NAME            TYPE     STATE   ENDPOINT                HEALTH
reviewer        managed  online  http://127.0.0.1:32768  ok
ssh-reviewer    ssh      online  -                       -
ssh-coder       ssh      online  http://127.0.0.1:49152  ok
coder           managed  offline -                       -
api-service     live     error   http://100.64.0.3:8080  unreachable
```

| Column | Description |
|--------|-------------|
| NAME | Worker name from YAML |
| TYPE | `managed` (Docker), `ssh`, `adapter`, or `live` (unmanaged) |
| STATE | `offline`, `online`, or `error` |
| ENDPOINT | Runtime URL. Docker: auto-assigned port. SSH oneshot: `-` (no persistent endpoint). SSH interactive: tunneled port. Live: from YAML |
| HEALTH | `ok`, `unreachable`, `-` (offline/oneshot), or error message |

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

## mecha doctor

Check system health and configuration. Read-only — never modifies state.

```bash
$ mecha doctor

System
  [ok]   ~/.mecha/ exists
  [ok]   database opens (2 workers, 5 tasks)
  [ok]   secrets file valid (1 token groups)
  [ok]   docker daemon reachable (API 1.47)

Workers (2 registered)
  claude-reviewer (managed)
    [ok]   cwd /home/user/project exists
    [ok]   token claude.xiaolaidev resolves
    [ok]   image mecha-worker-claude:latest available
  ollama-local (adapter)
    [!!]   upstream http://localhost:11434 unreachable

  [ok]   all checks passed
```

### System Checks

| Check | ok | warn | fail |
|-------|-----|------|------|
| `~/.mecha/` directory | Exists | — | Missing or not a directory |
| Database | Opens, reports worker/task counts | — | Cannot open or migrate |
| Secrets file | Valid YAML, correct permissions | File missing (optional) | Bad permissions or invalid YAML |
| Docker daemon | Responds to ping | — | Unreachable |

### Per-Worker Checks

| Check | ok | warn | fail |
|-------|-----|------|------|
| `docker.cwd` | Directory exists | — | Missing or not a directory |
| `docker.token` | Resolves from secrets | No secrets file loaded | Token reference not found |
| Docker image | Available locally | — | Not found locally (worker start will fail) |
| Adapter upstream | Responds to health check | Unreachable | — |
| `ssh.token` | Resolves from secrets | No secrets file loaded | Token reference not found |
| SSH connectivity | Host reachable via SSH | Unreachable (includes error detail) | — |
| `claude` CLI on remote | Found in PATH | — | Not found (worker start will fail) |
| `bun` on remote | Found (interactive mode) | Not found | — |

Exit code `1` if any check returns `[FAIL]`. Warnings (`[!!]`) do not affect exit code.

## mecha serve

Start the HTTP server for task dispatch and webhook handling.

```bash
$ mecha serve
time=... level=INFO msg=serving addr=127.0.0.1:8080

$ mecha serve --addr 0.0.0.0:8080 --api-key my-secret
time=... level=INFO msg=serving addr=0.0.0.0:8080
```

| Flag | Default | Description |
|------|---------|-------------|
| `--addr` | `127.0.0.1:8080` | Listen address |
| `--api-key` | (empty) | API key for authentication |

The server provides HTTP endpoints for task management, worker status, and webhook handling. See [API Reference](./api) and [Events](./events).

Shutdown: `Ctrl+C` (SIGINT) or `kill` (SIGTERM). In-flight tasks complete before exit.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `MECHA_DB_PATH` | Override database location (default: `~/.mecha/mecha.db`) |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Error (invalid args, worker not found, Docker failure, etc.) |
