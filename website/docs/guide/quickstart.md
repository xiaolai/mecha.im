# Quick Start

Create your first Mecha agent in 5 minutes.

## 1. Initialize

```bash
mecha init
```

## 2. Set Up Auth

```bash
# Add your API key
mecha auth add mykey --api-key --token sk-ant-api03-...

# Or use OAuth (preferred)
mecha auth add mytoken --oauth --token sk-ant-oat01-...

# Verify
mecha auth test mykey
```

## 3. Spawn an Agent

```bash
mecha spawn researcher ~/my-research --tags research
```

This creates a CASA named `researcher` with `~/my-research` as its workspace. The agent starts immediately.

## 4. Check Status

```bash
# List all agents
mecha ls

# Detailed status
mecha status researcher
```

You'll see something like:

```
researcher
  state:     running
  port:      7700
  workspace: /Users/you/my-research
  tags:      research
  sandbox:   auto
```

## 5. Chat with Your Agent

```bash
mecha chat researcher "What files are in my workspace?"
```

The response streams to your terminal in real time.

## 6. Spawn a Second Agent

```bash
mecha spawn coder ~/my-project --tags dev
```

## 7. Let Them Talk

Grant the coder permission to query the researcher:

```bash
mecha acl grant coder query researcher
```

Now when coder needs research help, it can query researcher through the mesh:

```bash
mecha chat coder "Ask the researcher about recent papers on transformers"
```

## 8. Monitor Costs

Start the metering proxy:

```bash
mecha meter start
```

Check spending:

```bash
mecha cost show
```

Set a daily budget:

```bash
mecha budget set --daily 5.00
```

## 9. Stop Agents

```bash
# Stop one
mecha stop researcher

# Kill one (immediate)
mecha kill coder

# List to confirm
mecha ls
```

## What's Next?

- [Core Concepts](/guide/concepts) — understand CASAs, naming, sessions
- [Permissions](/features/permissions) — fine-grained access control
- [Mesh Networking](/features/mesh-networking) — cross-machine agent communication
- [CLI Reference](/reference/cli) — complete command documentation
