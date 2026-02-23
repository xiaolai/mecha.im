# Docker Runtime Setup

Mecha requires a Docker-compatible runtime to run containerized agents.

## Recommended: Colima (macOS & Linux)

We recommend [Colima](https://github.com/abhinav/colima) for both macOS and Linux users. It's lightweight, open-source, and runs Docker containers with minimal setup — no Docker Desktop license required. On Linux it uses native containerd, on macOS it runs via a Lima VM.

```bash
# Install
brew install colima docker

# Start (allocate resources as needed)
colima start --cpu 4 --memory 8

# Verify
docker info
```

Colima starts on demand and uses minimal resources when idle. It integrates with the standard `docker` CLI.

## Other Supported Runtimes

| Runtime | Platform | Notes |
|---------|----------|-------|
| **Colima** | macOS, Linux | Recommended. Lightweight, free, open-source |
| **Docker Desktop** | macOS, Linux, Windows | Works out of the box. Requires license for commercial use |
| **OrbStack** | macOS | Fast, low resource usage. Free for personal use |
| **Rancher Desktop** | macOS, Linux, Windows | Free, includes Kubernetes |
| **Podman** | macOS, Linux | Daemonless. Experimental support |
| **Native Docker** | Linux | `apt install docker.io` or equivalent |

## Socket Auto-Detection

Mecha automatically detects the Docker socket in this order:

1. `DOCKER_HOST` environment variable
2. Active Docker context (`docker context inspect`)
3. Standard paths: `/var/run/docker.sock`, `~/.orbstack/run/docker.sock`, `~/.colima/default/docker.sock`, `~/.rd/docker.sock`

If `mecha doctor` reports Docker as unavailable, set `DOCKER_HOST` explicitly:

```bash
# Colima
export DOCKER_HOST=unix://$HOME/.colima/default/docker.sock

# OrbStack
export DOCKER_HOST=unix://$HOME/.orbstack/run/docker.sock
```

## Verify Setup

```bash
mecha doctor
```

This checks Docker availability and the `mecha-net` network. Run `mecha init` to create the network if needed.
