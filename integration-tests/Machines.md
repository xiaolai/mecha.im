## Machines

| Machine | Tailscale IP | OS | Arch | Install method |
|---------|-------------|-----|------|----------------|
| linode02 | 100.100.1.9 | Linux | x64 | `sudo npm install -g` |
| spark01 | 100.100.1.5 | Linux | arm64 | `sudo npm install -g` |
| mac-mini-home | 100.100.1.7 | macOS | arm64 | `npm install -g` (nvm node v22.22.0) |
| jokershp-wsl | 100.100.1.4 | Linux (WSL2 on Windows) | x64 | `npm install -g` inside WSL |

all users are `joker`
all sudo passwords are `xiaolai`
all ip addresses of the machines could be queried by `tailscale status`

## Windows (WSL) Setup

The Windows machine runs mecha inside WSL (Windows Subsystem for Linux). Claude Code requires a Unix shell, so native Windows is not a supported target — WSL provides the bash/POSIX environment bots need.

### Prerequisites

```bash
# Inside WSL terminal
wsl  # enter WSL from Windows

# Verify Node.js
node --version   # >= 20.0.0

# Install mecha (copy tgz from dev machine first)
npm install -g /path/to/mecha.im-0.2.16.tgz

# Tailscale: must be running on the Windows host (not inside WSL).
# WSL shares the host's Tailscale network interface, so the Tailscale IP
# is the host's IP. Verify connectivity:
tailscale.exe status   # from WSL, calls Windows tailscale

# Initialize
mecha init
mecha start -d --host 0.0.0.0
```

### Known WSL Considerations

- **Filesystem**: Use the WSL filesystem (`~/`), not `/mnt/c/`. Windows filesystem (NTFS via 9P) has poor performance and permission issues.
- **Networking**: WSL2 uses a virtual network adapter. Tailscale on the Windows host exposes the Tailscale IP. Bind to `0.0.0.0` so other machines can reach the agent.
- **Proxy**: If direct API access is blocked, configure proxy in bot env: `mecha bot configure <name>` then edit config.json to add `env.HTTPS_PROXY`.
- **node-pty**: Works in WSL using the Linux PTY implementation (not ConPTY). No special handling needed.
- **Sandbox**: WSL does not support Linux seccomp. The sandbox falls back to no OS-level isolation. This is acceptable for testing but should be noted in results.
- **Signals**: SIGTERM/SIGKILL work normally inside WSL (Linux kernel semantics).
- **File watching**: inotify works in WSL2 for WSL-native paths. Avoid `/mnt/c/` for workspace paths.
