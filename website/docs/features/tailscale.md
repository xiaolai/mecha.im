# Tailscale Mesh

Connect bot containers to a Tailscale or Headscale network for multi-machine bot-to-bot communication.

## Setup

### 1. Initialize with Headscale support

```bash
mecha init --headscale
```

### 2. Add a Tailscale auth key

```bash
mecha auth add ts-main tskey-auth-...
```

### 3. Configure bots

```yaml
name: reviewer
system: "You review code."
tailscale:
  auth_key_profile: ts-main
  tags:
    - "tag:mecha-bot"
```

## Config Fields

| Field | Description |
|-------|-------------|
| `auth_key_profile` | Name of a Tailscale auth key profile |
| `auth_key` | Direct auth key (mutually exclusive with `auth_key_profile`) |
| `login_server` | Custom Headscale server URL |
| `tags` | ACL tags (default: `["tag:mecha-bot"]`) |

::: warning
`auth_key` and `auth_key_profile` are mutually exclusive — use one or the other.
:::

## How It Works

When a bot has Tailscale config, the container:
1. Starts a Tailscale daemon via s6-overlay
2. Authenticates with the provided key
3. Joins the tailnet with the configured tags
4. Becomes discoverable by other bots via `mecha_list`
5. Can be called by other bots via `mecha_call`

## Multi-Machine

With Tailscale, bots on different physical machines can communicate as if they were on the same network. Run `mecha` on multiple machines, point them at the same tailnet, and bots discover each other automatically.
