# Networking

## Overview

Bot-to-bot communication uses Tailscale/Headscale mesh networking. Each container has Tailscale installed and joins a tailnet on boot. Docker bridge networking is not used for inter-bot traffic.

This gives multi-machine support for free — a bot on your laptop talks to a bot on your server the same way as two bots on the same machine.

## Topology

```
┌─ Machine A ──────────────────┐     ┌─ Machine B ──────────────────┐
│                               │     │                               │
│  ┌────────────┐               │     │               ┌────────────┐ │
│  │  reviewer   │               │     │               │  researcher │ │
│  │  tailscale  │◄──── tailnet ─────►│  tailscale  │ │
│  │  100.x.x.1 │               │     │               │  100.x.x.2 │ │
│  └────────────┘               │     │               └────────────┘ │
│                               │     │                               │
│  ┌────────────┐               │     │                               │
│  │ coordinator │               │     │                               │
│  │  100.x.x.3 │               │     │                               │
│  └────────────┘               │     │                               │
│                               │     │                               │
└───────────────────────────────┘     └───────────────────────────────┘

                    ┌──────────────────┐
                    │  Headscale       │
                    │  (coordination)  │
                    └──────────────────┘
```

## Two Modes

### 1. Join existing tailnet

Use your own Tailscale account or a Headscale server you already run.

```yaml
name: reviewer
tailscale:
  auth_key: tskey-auth-...                        # Tailscale auth key
  login_server: https://headscale.example.com     # optional, for Headscale
  tags: ["tag:mecha-bot"]
```

### 2. Self-hosted Headscale (mecha manages it)

Mecha spins up a Headscale container as the coordination server. Bots auto-join.

```bash
mecha init --headscale          # starts headscale container
mecha spawn reviewer.yaml       # bot joins the mecha headscale automatically
```

Zero external dependencies. Private tailnet for your bots.

## Container Tailscale Setup

### Dockerfile

```dockerfile
FROM node:22-alpine

# Install Tailscale
RUN apk add --no-cache tailscale

# Or pin a specific version
# RUN curl -fsSL https://pkgs.tailscale.com/stable/tailscale_${TS_VERSION}_linux_amd64.tgz \
#     | tar -xz -C /usr/local/bin --strip-components=1
```

### Boot sequence

```
1. Start tailscaled (daemon)
2. tailscale up --auth-key=... --hostname=mecha-{botname}
3. Wait for tailscale to be connected
4. Start HTTP server on :3000
5. Start scheduler
6. Ready
```

### Persistent identity

Tailscale state is stored in `/state/tailscale/`, mounted from host:

```
~/.mecha/bots/reviewer/
├── config.yaml
├── sessions/
├── data/
└── tailscale/          # tailscale state dir, persists identity across restarts
```

On restart, the bot reconnects with the same Tailscale identity — no new auth key needed.

### Container privileges

Two options:

**Kernel networking (recommended for production):**
```
docker run --cap-add=NET_ADMIN --device=/dev/net/tun ...
```

**Userspace networking (simpler, no special caps):**
```
tailscale up --userspace-networking=true ...
```

Userspace mode is sufficient for HTTP-based bot-to-bot calls. No special Docker privileges needed.

## Bot Discovery

### `mecha_list` tool

Queries Headscale API or Tailscale API for nodes tagged `tag:mecha-bot`:

```
Tool: mecha_list
Returns:
  bots: [
    { name: "reviewer",    host: "mecha-reviewer",    ip: "100.64.0.1", status: "online" },
    { name: "researcher",  host: "mecha-researcher",  ip: "100.64.0.2", status: "online" },
  ]
```

Discovers bots across all machines on the tailnet.

### `mecha_call` tool

Resolves bot name via MagicDNS:

```typescript
// mecha_call("reviewer", "check this PR")
// → POST http://mecha-reviewer:3000/prompt
```

Or by Tailscale IP if MagicDNS is unavailable:

```typescript
// → POST http://100.64.0.1:3000/prompt
```

## External Access

### No port exposure needed

Bots don't need `--expose` for most use cases. Tailscale handles routing.

### Webhooks via Tailscale Funnel

For receiving external webhooks (e.g., from GitHub):

```bash
# Inside the container
tailscale funnel 3000
# → https://mecha-reviewer.tail1234.ts.net/
```

Or run a shared ingress node that routes webhooks to the right bot.

### Webhooks via exposed port (fallback)

If Tailscale Funnel isn't available:

```yaml
expose: 8080    # maps host:8080 → container:3000
```

## Auth Key Management

Tailscale auth keys are stored as auth profiles:

```bash
mecha auth add tailscale-main tskey-auth-...
```

Bot config references the profile:

```yaml
tailscale:
  auth_key_profile: tailscale-main
```

Or inline for quick testing:

```yaml
tailscale:
  auth_key: tskey-auth-...
```

### Headscale mode

When mecha manages its own Headscale, auth keys are generated automatically at spawn time. No manual key management.

## Security

- Tailscale encrypts all traffic (WireGuard)
- ACLs control which bots can talk to which
- No ports exposed to the public internet by default
- Bot identity is tied to Tailscale node key, persisted across restarts
- Tags (`tag:mecha-bot`) enable group-level ACL rules

## Impact on CLI Commands

| Command | Change |
|---------|--------|
| `mecha init` | Add `--headscale` flag to start coordination server |
| `mecha spawn` | Container gets Tailscale auth key, joins tailnet |
| `mecha ls` | Shows Tailscale IP and online status alongside container status |
| `mecha stop` | Bot goes offline on tailnet |
| `mecha rm` | Bot removed from tailnet |

No new commands needed. Tailscale is transparent to the user.
