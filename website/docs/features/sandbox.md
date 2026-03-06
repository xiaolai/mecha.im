---
title: Sandbox & Security
description: Five layers of defense-in-depth isolation ensuring each agent only accesses what it is allowed to.
---

# Sandbox & Security

Mecha enforces **defense in depth** — five layers of isolation ensure that each agent can only access what it's explicitly allowed to.

## The 5 Layers

### Layer 1: Filesystem

Each bot can only read and write its own workspace directory. Path traversal attacks are blocked by resolving symlinks and checking canonical paths.

```
researcher's workspace: ~/papers/
  ✅ ~/papers/notes.md          (inside workspace)
  ❌ ~/papers/../secrets.txt    (traversal blocked)
  ❌ /etc/passwd                (outside workspace)
```

### Layer 2: Network

By default, bots can only communicate via localhost. The OS sandbox blocks raw outbound network access. API calls go through the metering proxy, which controls and tracks all Anthropic API usage.

### Layer 3: Process Permissions

Each bot runs with restricted process capabilities. The Claude Agent SDK's permission mode controls what tools the agent can use:

| Mode | Description |
|------|-------------|
| `default` | Ask before dangerous operations |
| `plan` | Plan-only mode (read, no write) |
| `full-auto` | Autonomous execution (use with caution) |

### Layer 4: OS Sandbox

The OS-level sandbox provides the strongest isolation:

**macOS** — Uses `sandbox-exec` with a custom profile:
- Filesystem access restricted to bot directory + workspace
- Network restricted to localhost
- No process spawning outside allowed paths

**Linux** — Uses `bwrap` (bubblewrap):
- Mount namespace isolation
- Read-only root filesystem
- Bind-mount only bot directory and workspace

**Fallback** — When no sandbox runtime is available:
- Process-level restrictions only
- Warning logged at startup

### Layer 5: ACL

The access control layer mediates all inter-agent communication. Even if two bots are on the same machine, they cannot interact without explicit permission grants.

## bot Home Directory Isolation

Each bot gets its own isolated Claude Code home directory. The host's real `~/.claude/` is never exposed.

### How It Works

When Mecha spawns a bot, it creates a complete `home/.claude/` mirror inside the bot directory:

```
~/.mecha/researcher/
├── home/
│   └── .claude/
│       ├── settings.json           ← auto-generated hook config
│       ├── hooks/
│       │   ├── sandbox-guard.sh    ← file access validator
│       │   └── bash-guard.sh       ← shell command filter
│       └── projects/
│           └── -home-alice-papers/    ← workspace-encoded sessions
│               ├── abc123.meta.json
│               └── abc123.jsonl
├── tmp/                            ← isolated TMPDIR
├── logs/
└── config.json
```

The `HOME` environment variable is redirected to `~/.mecha/researcher/home/`, so Claude Code reads settings from the bot's own directory — not the host's.

### Settings Are Generated, Not Inherited

The bot's `settings.json` is generated fresh by Mecha at spawn time with sandbox hooks pre-configured:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Read|Write|Edit|Glob|Grep",
        "hooks": [{
          "type": "command",
          "command": "$HOME/.claude/hooks/sandbox-guard.sh",
          "timeout": 5
        }]
      },
      {
        "matcher": "Bash",
        "hooks": [{
          "type": "command",
          "command": "$HOME/.claude/hooks/bash-guard.sh",
          "timeout": 5
        }]
      }
    ]
  }
}
```

::: warning
bots do **not** inherit settings, rules, or hooks from:
- The host's `~/.claude/` directory
- The workspace's `.claude/` directory
- Any parent directory's `.claude/` configuration

This is intentional — each bot is a clean, isolated environment.
:::

### Hook Scripts

Hook scripts are hardcoded by Mecha during spawn — they are not copied from the workspace or host. This prevents a compromised workspace from tampering with sandbox enforcement.

- **sandbox-guard.sh** — Receives tool input as JSON on stdin, extracts the `path` field, resolves symlinks via `realpath`, and verifies the resolved path is within the bot's sandbox root or workspace. Exits 0 (allow) or 2 (block).
- **bash-guard.sh** — Filters shell commands for safety.

These hooks run as `PreToolUse` handlers before every file access and shell command.

### Environment Isolation

The bot's child process receives a locked-down environment:

| Variable | Value | Purpose |
|----------|-------|---------|
| `HOME` | `botDir/home` | Redirects Claude Code settings |
| `TMPDIR` | `botDir/tmp` | Isolated temp directory |
| `MECHA_WORKSPACE` | Workspace path | The directory the agent can access |
| `MECHA_SANDBOX_ROOT` | bot root directory | Bounds check for sandbox hooks |
| `MECHA_PROJECTS_DIR` | `botDir/home/.claude/projects/<encoded>` | Session storage path |
| `PATH` | Minimal (node, /usr/bin, /bin) | No access to host tools |

Dangerous environment variables are blocked from propagating to the bot:

- All `MECHA_*` variables (prevents override)
- `BASH_ENV`, `ENV` (prevents shell injection)
- `NODE_*`, `LD_*`, `DYLD_*` (prevents library injection)
- `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN` (replaced with resolved auth)

### Workspace `.claude/` Files

Since `HOME` is redirected, Claude Code inside a bot does **not** walk up the filesystem to discover `.claude/` directories. This means:

- **`CLAUDE.md`** in the workspace root is still read by the Agent SDK (it reads relative to the working directory, not `HOME`)
- **`.claude/rules/`** in the workspace are still loaded (same reason — relative to workspace)
- **Host-level `~/.claude/settings.json`** is NOT read (the bot has its own)
- **Host-level plugins, hooks, MCP servers** are NOT available to the bot

## Inspecting Sandbox Status

```bash
# Show sandbox details for a bot
mecha sandbox show researcher
```

This displays:
- Sandbox mode (require/auto/off)
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

## Sandbox Package API Reference (`@mecha/sandbox`)

The `@mecha/sandbox` package provides OS-level process isolation. It detects the platform, generates sandbox profiles, and wraps spawn arguments.

### Types

#### `SandboxPlatform`

```ts
type SandboxPlatform = "macos" | "linux" | "fallback";
```

The detected sandbox backend.

#### `SandboxProfile`

```ts
interface SandboxProfile {
  botDir: string;          // Bot root directory (read-write)
  workspacePath: string;   // Workspace directory (read-write)
  allowNetwork: boolean;   // Whether outbound network is permitted
  readOnlyPaths?: string[]; // Additional read-only paths
  readWritePaths?: string[]; // Additional read-write paths
}
```

Describes what a sandboxed process is allowed to access.

#### `SandboxWrapResult`

```ts
interface SandboxWrapResult {
  command: string;     // The sandbox wrapper command (e.g., "sandbox-exec")
  args: string[];      // Arguments including the original command
  env?: Record<string, string>; // Additional environment variables
}
```

The result of wrapping a command with sandbox arguments.

#### `Sandbox`

```ts
interface Sandbox {
  platform: SandboxPlatform;
  available: boolean;
  wrap(profile: SandboxProfile, cmd: string, args: string[]): SandboxWrapResult;
}
```

The sandbox instance returned by `createSandbox()`.

### Functions

#### `detectPlatform(): SandboxPlatform`

Detects the current OS and returns the appropriate sandbox platform. Returns `"macos"` on Darwin, `"linux"` on Linux, and `"fallback"` elsewhere.

#### `checkAvailability(platform): boolean`

Checks whether the sandbox binary is available on the current system (`sandbox-exec` on macOS, `bwrap` on Linux). Always returns `true` for `"fallback"`.

#### `createSandbox(platformOverride?): Sandbox`

Creates a sandbox instance for the current (or overridden) platform.

```ts
import { createSandbox } from "@mecha/sandbox";

const sandbox = createSandbox();
if (sandbox.available) {
  const wrapped = sandbox.wrap(
    { botDir: "/home/.mecha/coder", workspacePath: "/projects/app", allowNetwork: false },
    "node",
    ["runtime.js"]
  );
  // Use wrapped.command and wrapped.args to spawn the process
}
```

#### `profileFromConfig(opts): SandboxProfile`

Build a `SandboxProfile` from bot configuration values.

```ts
import { profileFromConfig } from "@mecha/sandbox";

const profile = profileFromConfig({
  botDir: "/Users/you/.mecha/researcher",
  workspacePath: "/Users/you/papers",
  allowNetwork: false,
});
```

**`ProfileFromConfigOpts`**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `botDir` | `string` | Yes | Bot root directory |
| `workspacePath` | `string` | Yes | Workspace directory |
| `allowNetwork` | `boolean` | No | Allow outbound network (default: `false`) |
