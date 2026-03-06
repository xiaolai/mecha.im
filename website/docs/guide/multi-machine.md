---
title: Multi-Machine Setup
description: Run Mecha agents across multiple machines and route queries between them.
---

# Multi-Machine Setup

Run Mecha agents across multiple machines and route queries between them.

Mecha supports two connection modes. Choose based on your network:

| Mode | Best For | Requirements |
|------|----------|-------------|
| **P2P (invite)** | Internet, NAT, no port forwarding | Both machines can reach `rendezvous.mecha.im` |
| **HTTP (direct)** | LAN, VPN, controlled networks | Network connectivity between machines |

---

## P2P Setup (Recommended)

No firewall rules, no port forwarding, no shared secrets. Just exchange an invite code.

### Prerequisites

- Mecha installed on each machine
- Internet access (to reach the rendezvous server)

### Step 1: Initialize Nodes

On each machine:

```bash
mecha node init
```

This creates an Ed25519 identity keypair and X25519 Noise key in `~/.mecha/identity/`.

### Step 2: Create an Invite

On machine A (alice):

```bash
mecha node invite
```

Output:

```
mecha://invite/eyJpbnZpdGVyTm...
Expires: 2026-02-28T12:00:00Z (24h)
Share this code with your peer.
```

### Step 3: Accept the Invite

On machine B (bob):

```bash
mecha node join mecha://invite/eyJpbnZpdGVyTm...
```

Output:

```
Invite accepted on server (inviter notified)
Peer added: alice (managed)
```

Both nodes now know each other. Alice is also notified in real-time via the rendezvous server.

### Step 4: Spawn Agents

```bash
# On alice
mecha bot spawn coder ~/project --tags dev

# On bob
mecha bot spawn analyst ~/data --tags data
```

### Step 5: Set Up Permissions

```bash
# On alice — allow coder to query analyst on bob
mecha acl grant coder query analyst@bob

# On bob — allow incoming queries from alice
mecha acl grant coder@alice query analyst
```

Both sides must approve — double-check enforcement.

### Step 6: Test

```bash
# On alice — verify bob is reachable
mecha node ping bob

# On alice — send a cross-node query
mecha bot chat coder "Ask analyst@bob to summarize the sales data"
```

The query routes through an encrypted SecureChannel — no HTTP ports exposed, no API keys exchanged.

### Connection Flow

```mermaid
sequenceDiagram
    participant Alice as alice
    participant RV as Rendezvous
    participant Relay as Relay
    participant Bob as bob

    Alice->>RV: register
    Bob->>RV: register
    Note over Alice,Bob: Both nodes online

    Alice->>RV: requestRelay(bob)
    RV-->>Alice: relay token
    Alice->>Relay: connect (token)
    Bob->>Relay: connect (token)
    Note over Alice,Bob: Noise IK handshake
    Alice->>Bob: Encrypted queries
```

### Invite Options

```bash
# Longer expiry
mecha node invite --expires 7d

# Custom rendezvous server
mecha node invite --server wss://my-rendezvous.example.com
```

---

## HTTP Setup

For LAN/VPN environments where you prefer direct connections with full control.

### Prerequisites

- Mecha installed on each machine
- Network connectivity between machines (same LAN, VPN, or public IP)

### Step 1: Initialize Nodes

On each machine:

```bash
mecha node init
```

### Step 2: Start Agent Servers

Each machine needs an agent server to accept incoming queries:

```bash
# On alice
mecha agent start --host 0.0.0.0

# On bob
mecha agent start --host 0.0.0.0
```

::: warning
Using `--host 0.0.0.0` exposes the agent server to the network. Only do this on trusted networks or behind a firewall.
:::

### Step 3: Register Nodes

Each machine registers the other as a known node:

```bash
# On alice — register bob
mecha node add bob 192.168.1.50 --port 7660 --api-key <key>

# On bob — register alice
mecha node add alice 192.168.1.100 --port 7660 --api-key <key>
```

### Step 4: Spawn Agents

```bash
# On alice
mecha bot spawn coder ~/project --tags dev

# On bob
mecha bot spawn analyst ~/data --tags data
```

### Step 5: Set Up Permissions

```bash
# On alice
mecha acl grant coder query analyst@bob

# On bob
mecha acl grant coder@alice query analyst
```

### Step 6: Test

```bash
# On alice
mecha node ping bob
mecha bot chat coder "Ask analyst@bob to summarize the sales data"
```

---

## Auto-Discovery Setup

For Tailscale (or other overlay) networks, Mecha can automatically discover peers without manual `node add`.

### Step 1: Set Cluster Key

On each machine, add the same cluster key to `.env`:

```bash
MECHA_CLUSTER_KEY=my-secret-cluster-key
```

### Step 2: Start Agent Servers

```bash
mecha agent start --host 0.0.0.0
```

The agent scans Tailscale peers every 60 seconds and performs a timing-safe handshake with each one. Nodes with matching cluster keys are added to `nodes-discovered.json` automatically.

### Step 3: View Discovered Nodes

```bash
mecha node ls
```

The `Source` column shows `manual` or `discovered` for each node.

### Step 4: Promote (Optional)

To make a discovered node permanent:

```bash
mecha node promote bob
```

This moves the node from `nodes-discovered.json` to `nodes.json`, so it persists even if discovery is disabled.

See the [Mesh Networking](/features/mesh-networking#auto-discovery) page for full details on discovery behavior and security.

---

## Verifying Node Connections

```bash
# List all registered nodes with their type
mecha node ls
```

Example output:

```
Name    Type      Host           Port   Added
alice   managed   —              —      2026-02-27T10:00:00Z
bob     http      192.168.1.50   7660   2026-02-27T10:00:00Z
```

- **managed** — P2P node (connected via invite, routes through relay)
- **http** — direct node (connected via `node add`, routes through agent server)

## Network Requirements

### P2P Mode

| Direction | Destination | Protocol | Purpose |
|-----------|-------------|----------|---------|
| Outbound | `rendezvous.mecha.im:443` | WSS | Peer discovery + signaling |
| Outbound | `relay.mecha.im:443` | WSS | Encrypted channel transport |

No inbound ports needed. Works behind NAT and firewalls.

### HTTP Mode

| Direction | Port | Protocol | Purpose |
|-----------|------|----------|---------|
| Inbound | 7660 | HTTP | Agent server (mesh queries) |
| Internal | 7700-7799 | HTTP | bot runtime APIs (localhost only) |
| Internal | 7600 | HTTP | Metering proxy (localhost only) |

Only port 7660 needs to be accessible between machines.

## Troubleshooting

### P2P Mode

**"rendezvous server unreachable"**

- Check internet connectivity
- Verify the rendezvous URL: `mecha node ping bob --server wss://rendezvous.mecha.im`
- Check if WebSocket connections are blocked by a proxy/firewall

**"offline (not registered on rendezvous)"**

- Ensure the peer has run `mecha node init` and their machine is online
- The peer may need to run a command that triggers rendezvous registration

**"Cannot accept own invite"**

- You cannot join your own invite code — share it with a different machine

### HTTP Mode

**"Connection refused" to remote node**

- Check that the agent server is running: `mecha agent status`
- Verify the host/port: `mecha node ls`
- Check firewall rules for port 7660

### Both Modes

**"Access denied" for cross-node query**

- Check ACL on both sides — source node AND target node must have matching grants
- Use `mecha acl show` on each machine to verify rules

---

## API Reference

See [@mecha/core API Reference](/reference/api/core#discovery) for the discovery registry types and functions.
