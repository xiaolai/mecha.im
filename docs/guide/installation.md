---
title: Installation
description: How to install mecha and its dependencies.
---

# Installation

## Requirements

| Requirement | Version | Purpose |
|-------------|---------|---------|
| Go | 1.26.1+ | Build the mecha binary |
| Docker | 28+ | Run worker containers |
| macOS or Linux | Any | Supported platforms |

On macOS, prefer [Colima](https://github.com/abiosoft/colima) over Docker Desktop:

```bash
brew install colima docker
colima start --cpu 4 --memory 8
```

## Build from Source

```bash
git clone https://github.com/xiaolai/mecha.im.git
cd mecha.im
make build
```

This produces a `./mecha` binary. Copy it somewhere in your `$PATH`:

```bash
sudo cp mecha /usr/local/bin/
```

## Via `go install`

```bash
go install mecha.im/cmd/mecha@latest
```

Binary goes to `$GOPATH/bin/`.

## Build Worker Images

```bash
make image-claude    # Claude Code CLI worker
make image-codex     # Codex CLI worker
make image-gemini    # Gemini CLI worker
make images          # all three
```

Each image is built on `mecha-worker-base` (Bun runtime + common tools like git, curl, ripgrep, python3).

## Cross-Platform Builds

Build the Go binary for other platforms:

```bash
GOOS=linux GOARCH=amd64 go build -ldflags "-s -w" -o mecha-linux-amd64 ./cmd/mecha
GOOS=linux GOARCH=arm64 go build -ldflags "-s -w" -o mecha-linux-arm64 ./cmd/mecha
GOOS=darwin GOARCH=arm64 go build -ldflags "-s -w" -o mecha-darwin-arm64 ./cmd/mecha
```

Worker Docker images must be built on each target architecture (or use `docker buildx` for multi-arch builds).

## Verify

```bash
mecha version
```
