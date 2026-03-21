---
title: Node Commands
description: CLI reference for mecha node mesh networking commands
---

# Node Commands

[[toc]]

All node commands live under `mecha node`.

## `mecha node init`

Initialize this machine as a named node, generating an Ed25519 identity keypair.

```bash
mecha node init [options]
```

| Option | Description |
|--------|-------------|
| `--name <name>` | Node name (auto-generated if omitted) |

```bash
mecha node init
mecha node init --name my-server
```

## `mecha node add`

Register a remote peer node via HTTP.

```bash
mecha node add <name> <host> [options]
```

| Argument | Description |
|----------|-------------|
| `<name>` | Peer node name |
| `<host>` | Peer node hostname or IP |

| Option | Description | Default | Required |
|--------|-------------|---------|----------|
| `--port <port>` | Agent server port | `7660` | No |
| `--api-key <key>` | API key for authentication | | **Yes** |

```bash
mecha node add bob 192.168.1.50 --api-key mysecret
mecha node add server 192.168.1.10 --port 7661 --api-key mysecret
```

## `mecha node rm`

Remove a registered peer node.

```bash
mecha node rm <name>
```

| Argument | Description |
|----------|-------------|
| `<name>` | Peer node name |

## `mecha node ls`

List registered peer nodes.

```bash
mecha node ls
```

Displays a table with columns: Name, Type (`managed`, `http`, `tailscale`, `mdns`), Source (`manual` or `discovered`), Host, Port, Last Seen.

Discovered nodes (found via auto-discovery) appear alongside manually added nodes.

## `mecha node promote`

Promote a discovered node to the manual registry (persistent).

```bash
mecha node promote <name>
```

| Argument | Description |
|----------|-------------|
| `<name>` | Name of the discovered node to promote |

Moves a node from `nodes-discovered.json` to `nodes.json`, making it permanent. Use this when you want a discovered node to persist across restarts even if auto-discovery is disabled.

```bash
mecha node promote bob
```

## `mecha node ping`

Test connectivity to a peer node.

```bash
mecha node ping <name> [options]
```

| Argument | Description |
|----------|-------------|
| `<name>` | Peer node name |

| Option | Description |
|--------|-------------|
| `--server <url>` | Rendezvous server URL (overrides default) |

For **managed** nodes, checks online status via the rendezvous server. For **HTTP** nodes, pings the `/healthz` endpoint.

```bash
mecha node ping bob
mecha node ping bob --server wss://my-rendezvous.example.com
```

## `mecha node health`

Check health of mesh nodes with latency and bot count.

```bash
mecha node health [name]
```

| Argument | Description |
|----------|-------------|
| `[name]` | Specific node name (omit for all) |

For **HTTP** nodes, checks `/healthz` and fetches bot count from `/bots`. For **managed** nodes, checks online status via the rendezvous server.

```bash
mecha node health
mecha node health bob
```

## `mecha node info`

Show local node system information (hostname, OS, network IPs, CPU, memory, running bot count).

```bash
mecha node info
```

```bash
mecha node info
mecha node info --json
```

## `mecha node invite`

Create a one-time invite code for P2P peer discovery.

```bash
mecha node invite [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--expires <duration>` | Invite expiry. Accepts: `1h`, `6h`, `24h`, `7d` | `24h` |
| `--server <url>` | Rendezvous server URL (overrides default) | |

The invite code is registered on the rendezvous server (best-effort -- works offline too). Share the code with your peer.

```bash
mecha node invite
mecha node invite --expires 7d
mecha node invite --server wss://my-rendezvous.example.com
```

## `mecha node join`

Accept an invite and connect to a peer.

```bash
mecha node join <code> [options]
```

| Argument | Description |
|----------|-------------|
| `<code>` | Invite code (`mecha://invite/...`) |

| Option | Description | Default |
|--------|-------------|---------|
| `--force` | Overwrite if peer already in registry | `false` |

The peer is added as a **managed** node -- communication routes through the rendezvous/relay infrastructure instead of direct HTTP.

```bash
mecha node join mecha://invite/eyJ...
mecha node join mecha://invite/eyJ... --force
```

---

## See Also

- [CLI Reference](./) -- overview and global options
- [Mesh Networking](/features/mesh-networking) -- multi-node setup with `mecha node`
