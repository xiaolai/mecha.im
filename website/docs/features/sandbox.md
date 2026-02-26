# Sandbox & Security

Mecha enforces **defense in depth** — five layers of isolation ensure that each agent can only access what it's explicitly allowed to.

## The 5 Layers

### Layer 1: Filesystem

Each CASA can only read and write its own workspace directory. Path traversal attacks are blocked by resolving symlinks and checking canonical paths.

```
researcher's workspace: ~/papers/
  ✅ ~/papers/notes.md          (inside workspace)
  ❌ ~/papers/../secrets.txt    (traversal blocked)
  ❌ /etc/passwd                (outside workspace)
```

### Layer 2: Network

By default, CASAs can only communicate via localhost. The OS sandbox blocks raw outbound network access. API calls go through the metering proxy, which controls and tracks all Anthropic API usage.

### Layer 3: Process Permissions

Each CASA runs with restricted process capabilities. The Claude Agent SDK's permission mode controls what tools the agent can use:

| Mode | Description |
|------|-------------|
| `default` | Ask before dangerous operations |
| `plan` | Plan-only mode (read, no write) |
| `full-auto` | Autonomous execution (use with caution) |

### Layer 4: OS Sandbox

The OS-level sandbox provides the strongest isolation:

**macOS** — Uses `sandbox-exec` with a custom profile:
- Filesystem access restricted to CASA directory + workspace
- Network restricted to localhost
- No process spawning outside allowed paths

**Linux** — Uses `bwrap` (bubblewrap):
- Mount namespace isolation
- Read-only root filesystem
- Bind-mount only CASA directory and workspace

**Fallback** — When no sandbox runtime is available:
- Process-level restrictions only
- Warning logged at startup

### Layer 5: ACL

The access control layer mediates all inter-agent communication. Even if two CASAs are on the same machine, they cannot interact without explicit permission grants.

## Sandbox Hooks

Mecha installs hooks into each CASA's Claude Code configuration:

- **sandbox-guard.sh** — Validates file access against workspace boundaries
- **bash-guard.sh** — Filters shell commands for safety

These hooks run before every tool call, adding an extra validation layer on top of the OS sandbox.

## Inspecting Sandbox Status

```bash
# Show sandbox details for a CASA
mecha sandbox show researcher
```

This displays:
- Sandbox mode (strict/auto/off)
- Platform sandbox type (sandbox-exec/bwrap/none)
- Workspace path and allowed directories
- Network restrictions

## Security Boundaries

### What Agents Can Do
- Read/write files in their workspace
- Make API calls through the metering proxy
- Query other agents (if ACL allows)
- Access MCP tools registered to their instance

### What Agents Cannot Do
- Access files outside their workspace
- Make arbitrary network connections
- Spawn unrestricted child processes
- Read other agents' sessions or configuration
- Bypass the metering proxy for API calls
