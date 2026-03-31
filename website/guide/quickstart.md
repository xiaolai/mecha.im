---
title: Quick Start
description: Your first Claude worker in 5 minutes.
---

# Quick Start

Get a Claude worker running in 5 minutes.

::: tip No Docker? Use SSH workers
If you have a remote machine with `claude` CLI installed, you can skip Docker entirely. See [SSH Quick Start](#ssh-quick-start-no-docker) below.
:::

## Docker Quick Start

### Prerequisites

- [Go 1.26+](https://go.dev/dl/) installed
- [Docker](https://docs.docker.com/get-docker/) running (or [Colima](https://github.com/abiosoft/colima) on macOS)
- A Claude setup token (from `claude setup-token`)

## Step 1: Build mecha

```bash
git clone https://github.com/xiaolai/mecha.im.git
cd mecha.im
make build
```

You now have a `./mecha` binary.

## Step 2: Build the worker image

```bash
make image-claude
```

This builds `mecha-worker-base` (Bun + common tools) and `mecha-worker-claude` (base + Claude Code CLI).

## Step 3: Set up secrets

Create your secrets file:

```bash
mkdir -p ~/.mecha
cat > ~/.mecha/secrets.yml << 'EOF'
tokens:
  claude:
    default: YOUR_CLAUDE_SETUP_TOKEN_HERE
EOF
chmod 600 ~/.mecha/secrets.yml
```

Replace `YOUR_CLAUDE_SETUP_TOKEN_HERE` with your token from `claude setup-token` (starts with `sk-ant-oat01-`).

## Step 4: Create a worker YAML

```bash
cat > workers/my-reviewer.yml << 'EOF'
name: my-reviewer
docker:
  image: mecha-worker-claude:latest
  resources:
    cpu: 2
    memory: 4G
  lifecycle: persistent
  env:
    CLAUDE_MODEL: claude-haiku-4-5-20251001
    CLAUDE_PERMISSION_MODE: bypassPermissions
    CLAUDE_EFFORT: low
  token: claude.default
timeout: 10m
EOF
```

## Step 5: Start the worker

```bash
./mecha worker add workers/my-reviewer.yml
./mecha worker start my-reviewer
```

You should see:

```
added my-reviewer (managed)
creating container for my-reviewer...
started my-reviewer (container)
```

## Step 6: Check status

```bash
./mecha worker ls
```

```
NAME          TYPE     STATE   ENDPOINT                HEALTH
my-reviewer   managed  online  http://127.0.0.1:32768  ok
```

## Step 7: Send a task

```bash
curl -s -X POST http://127.0.0.1:32768/task \
  -H "Content-Type: application/json" \
  -d '{"id":"test","prompt":"What is 2+2? Answer with just the number."}' \
  | python3 -m json.tool
```

```json
{
    "output": "4",
    "metadata": {
        "model": "claude-haiku-4-5-20251001",
        "duration_ms": 2100,
        "exit_code": 0
    }
}
```

## Step 8: Clean up

```bash
./mecha worker stop my-reviewer
./mecha worker remove my-reviewer
```

## SSH Quick Start (No Docker)

Run Claude CLI on a remote machine via SSH — no Docker needed.

### Prerequisites

- A remote machine with SSH access and `claude` CLI installed
- A Claude setup token (from `claude setup-token`)

### Step 1: Build mecha

```bash
git clone https://github.com/xiaolai/mecha.im.git
cd mecha.im
make build
```

### Step 2: Set up secrets

```bash
mkdir -p ~/.mecha
cat > ~/.mecha/secrets.yml << 'EOF'
tokens:
  claude:
    default: YOUR_CLAUDE_SETUP_TOKEN_HERE
EOF
chmod 600 ~/.mecha/secrets.yml
```

### Step 3: Create a worker YAML

```bash
cat > workers/ssh-reviewer.yml << 'EOF'
name: ssh-reviewer
ssh:
  host: your-remote-host         # hostname or IP
  user: your-username             # SSH user
  mode: oneshot                   # fresh CLI invocation per task
  cwd: /home/user/projects/repo  # remote working directory
  env:
    CLAUDE_MODEL: claude-haiku-4-5-20251001
  token: claude.default
timeout: 10m
EOF
```

### Step 4: Start the worker

```bash
./mecha worker add workers/ssh-reviewer.yml
./mecha worker start ssh-reviewer
```

You should see:

```
added ssh-reviewer (ssh)
connecting to your-username@your-remote-host...
checking claude cli on your-remote-host...
started ssh-reviewer (ssh/oneshot)
```

### Step 5: Check status

```bash
./mecha worker ls
```

```
NAME            TYPE  STATE   ENDPOINT  HEALTH
ssh-reviewer    ssh   online  -         -
```

Oneshot SSH workers have no persistent endpoint — tasks are executed directly via SSH on demand.

## Next Steps

- [Worker Configuration](./workers) — all YAML fields explained
- [Secrets Setup](./secrets) — managing tokens for Claude, Codex, Gemini
- [CLI Reference](./cli) — every command with examples
- [Architecture](./architecture) — how it works under the hood
