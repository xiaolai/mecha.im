# Core Concepts

## CASA

A **CASA** (Claude Agent SDK App) is the fundamental unit in Mecha. Each CASA is an isolated process running a Fastify HTTP server that wraps the Claude Agent SDK.

When you run `mecha spawn researcher ~/papers`, Mecha:

1. Creates a directory at `~/.mecha/researcher/`
2. Generates a config file with a random port and auth token
3. Sets up OS-level sandbox restrictions
4. Spawns the runtime process
5. Waits for the health check to pass

Each CASA has:

| Component | Description |
|-----------|-------------|
| **Name** | Human-readable identifier (`researcher`, `coder`) |
| **Workspace** | The directory the agent can read and write |
| **Port** | HTTP port for the runtime API (auto-assigned from 7700-7799) |
| **Token** | Random Bearer token for API authentication |
| **Tags** | Labels for organization and discovery |
| **Sessions** | Persistent chat conversations stored as JSONL |

## Names and Addresses

### Local Names

Every CASA has a unique name on its node:

```
researcher
coder
reviewer
```

Names must be lowercase alphanumeric with hyphens, max 64 characters.

### Fully Qualified Addresses

When communicating across machines, addresses include the node name:

```
researcher@alice       ← "researcher" on node "alice"
coder@bob              ← "coder" on node "bob"
```

### Group Addresses

The `+` prefix addresses all CASAs with a matching tag:

```
+research              ← all CASAs tagged "research"
+dev                   ← all CASAs tagged "dev"
```

### Local Shorthand

An unqualified name like `researcher` resolves to `researcher@local` — the CASA on the current node.

## Sessions

Each chat conversation is a **session** — stored as two files:

```
~/.mecha/researcher/home/.claude/projects/<path>/
├── abc123.meta.json     ← metadata (title, timestamps)
└── abc123.jsonl         ← transcript (messages, tool calls)
```

Sessions persist across CASA restarts. You can list and review them:

```bash
mecha sessions list researcher
mecha sessions show researcher <session-id>
```

The JSONL format matches the Claude Agent SDK's native transcript format — user messages, assistant responses, tool calls, and progress events.

## Workspaces

A workspace is the directory a CASA is allowed to access. When you spawn an agent:

```bash
mecha spawn coder ~/my-project
```

The agent can read and write files inside `~/my-project/` but nowhere else. The OS sandbox enforces this boundary.

The workspace path is encoded into the session storage path (matching Claude Code's convention):

```
/Users/you/my-project → -Users-you-my-project
```

## Tags

Tags organize CASAs into logical groups:

```bash
# Spawn with tags
mecha spawn researcher ~/papers --tag research --tag ml

# Find by tag
mecha find --tag research

# Configure tags later
mecha configure researcher --tag research --tag nlp
```

Tags power:
- **Discovery** — `mecha find --tag dev` lists all dev agents
- **Group addressing** — `+research` targets all research agents
- **ACL rules** — grant permissions to groups by tag

## State Machine

Each CASA has a lifecycle state:

```mermaid
stateDiagram-v2
  [*] --> spawning
  spawning --> running
  running --> stopped
  running --> error
```

| State | Meaning |
|-------|---------|
| `spawning` | Process is starting, health check pending |
| `running` | Healthy and accepting requests |
| `stopped` | Gracefully stopped via `mecha stop` |
| `error` | Crashed or failed health check |

Check state with:

```bash
mecha ls              # all CASAs
mecha status coder    # single CASA detail
```

## Directory Structure

All Mecha state lives under `~/.mecha/`:

```
~/.mecha/
├── researcher/                  ← CASA directory
│   ├── config.json              ← port, token, workspace, tags
│   ├── state.json               ← running/stopped/error
│   ├── logs/
│   │   ├── stdout.log
│   │   └── stderr.log
│   ├── home/.claude/            ← Claude Code home (sessions, hooks)
│   └── tmp/                     ← isolated temp directory
├── coder/                       ← another CASA
├── auth/
│   └── profiles.json            ← API key / OAuth token profiles
├── acl.json                     ← permission rules
├── nodes.json                   ← known remote nodes
├── identity/                    ← Ed25519 keypair for this node
└── meter/                       ← cost tracking data
```

No SQLite, no databases. Everything is plain JSON files that you can inspect, back up, and version control.
