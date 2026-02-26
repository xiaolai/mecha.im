# Multi-Machine Setup

Run Mecha agents across multiple machines and route queries between them.

## Prerequisites

- Mecha installed on each machine
- Network connectivity between machines (same LAN, VPN, or public IP)
- An API key shared between nodes for authentication

## Step 1: Initialize Nodes

On each machine, generate an identity:

```bash
# On machine A (alice)
mecha node init

# On machine B (bob)
mecha node init
```

This creates an Ed25519 keypair in `~/.mecha/identity/`.

## Step 2: Start Agent Servers

Each machine needs an agent server to accept incoming queries:

```bash
# On alice
export MECHA_AGENT_API_KEY=shared-secret-alice
mecha agent start --host 0.0.0.0

# On bob
export MECHA_AGENT_API_KEY=shared-secret-bob
mecha agent start --host 0.0.0.0
```

::: warning
Using `--host 0.0.0.0` exposes the agent server to the network. Only do this on trusted networks or behind a firewall.
:::

## Step 3: Register Nodes

Each machine registers the other as a known node:

```bash
# On alice — register bob
mecha node add bob --host 192.168.1.50 --port 7660 --api-key shared-secret-bob

# On bob — register alice
mecha node add alice --host 192.168.1.100 --port 7660 --api-key shared-secret-alice
```

## Step 4: Spawn Agents

```bash
# On alice
mecha spawn coder ~/project --tags dev

# On bob
mecha spawn analyst ~/data --tags data
```

## Step 5: Set Up Permissions

On alice, allow coder to query analyst on bob:

```bash
# On alice
mecha acl grant coder query analyst@bob
```

On bob, allow incoming queries from alice to analyst:

```bash
# On bob
mecha acl grant coder@alice query analyst
```

Both sides must approve — double-check enforcement.

## Step 6: Test

```bash
# On alice
mecha chat coder "Ask analyst@bob to summarize the sales data"
```

The query routes through alice's agent server to bob's agent server, which forwards it to the local `analyst` CASA.

## Network Requirements

| Direction | Port | Protocol | Purpose |
|-----------|------|----------|---------|
| Inbound | 7660 | HTTP | Agent server (mesh queries) |
| Internal | 7700-7799 | HTTP | CASA runtime APIs (localhost only) |
| Internal | 7600 | HTTP | Metering proxy (localhost only) |

Only port 7660 needs to be accessible between machines. CASA ports and the meter proxy are localhost-only.

## Troubleshooting

### "Connection refused" to remote node

- Check that the agent server is running: `mecha agent status`
- Verify the host/port: `mecha node ls`
- Check firewall rules for port 7660

### "Unauthorized" from remote node

- Verify the API key matches: the key in `mecha node add` must match the remote node's `MECHA_AGENT_API_KEY`

### "Access denied" for cross-node query

- Check ACL on both sides — source node AND target node must have matching grants
- Use `mecha acl show` on each machine to verify rules
