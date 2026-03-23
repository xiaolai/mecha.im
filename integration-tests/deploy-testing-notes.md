# Mecha Deploy & Testing Notes

Date: 2026-03-21 (updated)

## Summary

All machines use `npm install -g` for installation. Homebrew installation has been abandoned.

## Machines

| Machine | Tailscale IP | OS | Arch | Node.js | npm global prefix |
|---------|-------------|-----|------|---------|-------------------|
| linode02 | 100.100.1.9 | Linux | x64 | v22.22.1 | `/usr/lib` (sudo required) |
| spark01 | 100.100.1.5 | Linux | arm64 | v22.22.0 | `/usr/lib` (sudo required) |
| mac-mini-home | 100.100.1.7 | macOS | arm64 | v25.8.1 | `/opt/homebrew` (no sudo) |
| jokershp-wsl | 100.100.1.4 | Linux (WSL2) | x64 | TBD | TBD |

all users are `joker`
all sudo passwords are `xiaolai`
all ip addresses of the machines could be queried by `tailscale status`

## Installation (npm install -g)

All machines use the same method: build locally, pack, scp, install.

### Build and pack (from dev machine)

```bash
cd /Users/joker/github/xiaolai/myprojects/mecha.im-v2
pnpm build && cd packages/cli && npm pack
# produces: packages/cli/mecha.im-0.2.16.tgz
```

### Deploy to all machines

```bash
TGZ=/Users/joker/github/xiaolai/myprojects/mecha.im-v2/packages/cli/mecha.im-0.2.16.tgz

# Copy to all machines
scp $TGZ joker@100.100.1.7:/tmp/
scp $TGZ joker@100.100.1.5:/tmp/
scp $TGZ joker@100.100.1.9:/tmp/
```

### Per-machine install

```bash
# mac-mini-home (macOS — no sudo needed, Homebrew node owns prefix)
ssh joker@100.100.1.7 'npm install -g /tmp/mecha.im-0.2.16.tgz'

# spark01 (Linux arm64 — sudo required)
ssh joker@100.100.1.5 'echo "xiaolai" | sudo -S npm install -g /tmp/mecha.im-0.2.16.tgz'

# linode02 (Linux x64 — sudo required)
echo "xiaolai" | ssh joker@100.100.1.9 'sudo -S npm install -g /tmp/mecha.im-0.2.16.tgz'
```

### One-liner: deploy to all machines

```bash
TGZ=/Users/joker/github/xiaolai/myprojects/mecha.im-v2/packages/cli/mecha.im-0.2.16.tgz

scp $TGZ joker@100.100.1.7:/tmp/ &
scp $TGZ joker@100.100.1.5:/tmp/ &
scp $TGZ joker@100.100.1.9:/tmp/ &
wait

ssh joker@100.100.1.7 'npm install -g /tmp/mecha.im-0.2.16.tgz 2>&1 | tail -1' &
ssh joker@100.100.1.5 'echo "xiaolai" | sudo -S npm install -g /tmp/mecha.im-0.2.16.tgz 2>&1 | tail -1' &
echo "xiaolai" | ssh joker@100.100.1.9 'sudo -S npm install -g /tmp/mecha.im-0.2.16.tgz 2>&1 | tail -1' &
wait
```

### Verify

```bash
ssh joker@100.100.1.7 'mecha --version'   # → 0.2.16
ssh joker@100.100.1.5 'mecha --version'   # → 0.2.16
ssh joker@100.100.1.9 'mecha --version'   # → 0.2.16
```

## Clean Up Previous Installation

For a fresh deploy, stop everything and remove all state. Back up `.env` first.

```bash
# 1. Stop mecha (if running)
mecha stop --force 2>/dev/null || true

# 2. Kill any leftover processes
pkill -f "[m]echa start" 2>/dev/null || true

# 3. Back up .env (contains API keys)
cp ~/.mecha/.env /tmp/mecha-env-backup 2>/dev/null || true

# 4. Remove all mecha state and data
rm -rf ~/.mecha/

# 5. Remove npm global install
npm uninstall -g mecha.im 2>/dev/null || true
# On Linux with sudo:
sudo npm uninstall -g mecha.im 2>/dev/null || true

# 6. Remove any leftover Homebrew install (macOS only, legacy)
brew uninstall mecha 2>/dev/null || true
rm -f /opt/homebrew/bin/mecha
```

#### What lives where

| Directory | Contents | Safe to delete? |
|-----------|----------|-----------------|
| `~/.mecha/` | Bot configs, session history, TOTP secret, PID files, agent.json, budgets, nodes.json, acl.json | Yes — but loses all bot state and TOTP setup |
| npm global `node_modules/mecha.im/` | Installed package | Yes — `npm uninstall -g mecha.im` |

#### Per-machine full cleanup

```bash
# mac-mini-home
ssh joker@100.100.1.7 'pkill -f "[m]echa" || true; rm -rf ~/.mecha/; npm uninstall -g mecha.im 2>/dev/null || true'

# linode02
ssh joker@100.100.1.9 'pkill -f "[m]echa" || true; rm -rf ~/.mecha/; sudo npm uninstall -g mecha.im 2>/dev/null || true'

# spark01
ssh joker@100.100.1.5 'pkill -f "[m]echa" || true; rm -rf ~/.mecha/; sudo npm uninstall -g mecha.im 2>/dev/null || true'
```

After cleanup, proceed with a fresh install and `mecha init` to regenerate TOTP and node identity.

## Deployment Workflow

```bash
# 1. Install (see above)

# 2. Initialize
mecha init

# 3. Start (daemon mode, bind to all interfaces for cross-node access)
mecha start -d --host 0.0.0.0

# 4. Check status
mecha status

# 5. Register peer nodes (mesh networking)
MESH_KEY=$(node -e "const c=require('crypto'),f=require('fs'),p=require('path');const s=f.readFileSync(p.join(require('os').homedir(),'.mecha/totp-secret'),'utf-8').trim();console.log(c.createHmac('sha256',s).update('mecha-mesh-routing').digest('hex'))")
mecha node add <peer-name> <peer-tailscale-ip> --api-key $MESH_KEY

# 6. Manage bots
mecha bot spawn coder ~/project --sandbox off
mecha bot ls
mecha bot ls --mesh   # shows bots on all registered nodes

# 7. Stop everything
mecha stop --force
```

## Known Platform Issues

### node-pty (optional)

`node-pty` is a native addon requiring a C++ compiler. On machines without build tools (linode02), `npm install` silently skips it. The daemon starts without PTY support — terminal feature is unavailable but all other features work.

To enable PTY (terminal feature):
```bash
# Install build tools first
sudo apt-get install -y build-essential  # Debian/Ubuntu
# Then reinstall mecha
sudo npm install -g /tmp/mecha.im-0.2.16.tgz
```

### WSL (jokershp-wsl)

- Mecha runs inside WSL, not native Windows
- WSL2 uses a virtual network adapter — Tailscale runs on the Windows host
- API access requires proxy configuration: set `env.HTTPS_PROXY=http://10.0.0.5:6152` in bot config if direct API access is blocked
- Sandbox: WSL does not support bwrap seccomp — falls back to no OS-level isolation
- Use WSL filesystem (`~/`), not `/mnt/c/` for workspace paths

### Sandbox (bwrap on Linux)

- `--tmpfs /tmp` must come BEFORE workspace bind mounts (fixed in `638d6cc`)
- Bots with workspace under `/tmp/` need this ordering or their CWD is invisible inside the sandbox
- macOS uses `sandbox-exec` with unrestricted `file-read*` — no ordering issues

### Shared HOME (--home flag)

When multiple bots share `--home`, the spawn pipeline merges `settings.json` instead of overwriting. MCP tool permissions are auto-added. Credentials are skipped if they already exist.

```bash
# Company-wide shared HOME
mecha bot spawn alice /projects/frontend --home ~/.mecha/_company
mecha bot spawn bob   /projects/backend  --home ~/.mecha/_company
```

## Mesh Networking Setup

### Derive mesh API key (same on all machines sharing TOTP secret)

```bash
MESH_KEY=$(node -e "const c=require('crypto'),f=require('fs'),p=require('path');const s=f.readFileSync(p.join(require('os').homedir(),'.mecha/totp-secret'),'utf-8').trim();console.log(c.createHmac('sha256',s).update('mecha-mesh-routing').digest('hex'))")
```

### Register full mesh (3 nodes)

```bash
# From mac-mini
mecha node add linode02 100.100.1.9 --api-key $MESH_KEY
mecha node add spark01  100.100.1.5 --api-key $MESH_KEY

# From linode02
mecha node add mac-mini 100.100.1.7 --api-key $MESH_KEY
mecha node add spark01  100.100.1.5 --api-key $MESH_KEY

# From spark01
mecha node add mac-mini 100.100.1.7 --api-key $MESH_KEY
mecha node add linode02 100.100.1.9 --api-key $MESH_KEY
```

### Verify mesh

```bash
mecha node ping linode02    # should show latency
mecha node ping spark01
mecha bot ls --mesh         # shows bots on all nodes
```

### Cross-node ACL

ACL must be set on BOTH sides for cross-node queries:
```bash
# On the SOURCE node (where the querying bot lives)
mecha acl grant alice query bob@linode02

# On the TARGET node (where the target bot lives)
mecha acl grant alice@mac-mini query bob
```

## API Notes

- Auth: `POST /auth/login` with TOTP code (returns session cookie)
- Mesh auth: `Authorization: Bearer <mesh-key>` + `X-Mecha-Source: <bot@node>` header
- Spawn: `POST /bots` with `workspacePath` field
- Health: `GET /healthz` (no auth)
- Default ports: agent 7660, meter 7600, bots 7700-7799

## Network Notes

- Use Tailscale IPs for all inter-machine communication
- linode02 public IP: 172.235.57.219 (updated)
- SSH auth: key-only for linode02, password `xiaolai` for spark01/mac-mini-home

## Release History

| Version | Date | Key changes |
|---------|------|-------------|
| v4.1.4 | 2026-03-23 | ACL source identity normalization (bot@local matching), meter proxy stale state fix, remote target expose skip, task protocol docs, architecture guide |
| v4.1.0 | 2026-03-22 | Inter-bot task protocol (A2A-inspired), task MCP tools, 15 tool-set total |
| v0.2.16 | 2026-03-21 | Orchestration layers (bus, workflow, observe, teams), settingSources fix, bwrap tmpfs fix, auto-register MCP, mesh routing proxy, node-pty optional, settings.json merge, bot ls --mesh |
| v0.2.2 | 2026-03-09 | Audit fixes, PID safety, dep vulnerabilities, port validation |
| v0.2.1 | 2026-03-09 | Daemon mode, CLI lock fix, status command, spawn errors |
