---
title: Sandbox & Security
description: Five layers of defense-in-depth isolation ensuring each agent only accesses what it is allowed to.
---

# Sandbox & Security

[[toc]]

Mecha enforces **defense in depth** — five layers of isolation ensure that each agent can only access what it's explicitly allowed to.

## The 5 Layers

### Layer 1: Filesystem

Each bot can only read and write its own workspace directory. Path traversal attacks are blocked by resolving symlinks and checking canonical paths.

```text
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
| `bypassPermissions` | Autonomous execution (requires `sandboxMode: require`) |
| `acceptEdits` | Auto-accept file edits, prompt for other tools |
| `dontAsk` | Skip tools that require permission |
| `auto` | Automatically determine permission handling |

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

When Mecha spawns a bot, it creates a complete `.claude/` mirror inside the bot directory:

```text
~/.mecha/researcher/             ← botDir (= HOME)
├── .claude/
│   ├── settings.json            ← auto-generated hook config
│   ├── hooks/
│   │   ├── sandbox-guard.sh     ← file access validator
│   │   └── bash-guard.sh        ← shell command filter
│   └── projects/
│       └── -home-alice-papers/ ← workspace-encoded sessions
│           ├── abc123.meta.json
│           └── abc123.jsonl
├── tmp/                         ← isolated TMPDIR
├── logs/
└── config.json
```

The `HOME` environment variable is redirected to `~/.mecha/researcher/` (the bot directory itself), so Claude Code reads settings from the bot's own `.claude/` directory — not the host's.

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
| `HOME` | `botDir` (or `config.home`) | Redirects Claude Code settings |
| `TMPDIR` | `botDir/tmp` | Isolated temp directory |
| `MECHA_WORKSPACE` | Workspace path | The directory the agent can access |
| `MECHA_SANDBOX_ROOT` | bot root directory | Bounds check for sandbox hooks |
| `MECHA_PROJECTS_DIR` | `HOME/.claude/projects/<encoded>` | Session storage path |
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

## Platform Implementations

The `@mecha/sandbox` package provides platform-specific wrappers that enforce OS-level isolation. Each platform module exports a pure `wrap*` function that transforms a command into its sandboxed equivalent, returning a `SandboxWrapResult`.

### macOS (`sandbox-exec`)

macOS sandboxing uses Apple's `sandbox-exec` with a Sandbox Profile Language (SBPL) policy file. The profile is generated from a `SandboxProfile` and written atomically to the bot directory.

#### `generateSbpl(profile)`

Generates a macOS Sandbox Profile Language (.sbpl) string from a `SandboxProfile`. This is a pure function with no I/O side effects.

The generated profile starts with `(deny default)` and selectively allows:
- System calls: `sysctl-read`, `mach-lookup`, `process-fork`, `signal`
- Unrestricted file reads (`file-read*`) — security is enforced via write and process-exec restrictions
- File writes only to paths listed in `profile.writePaths`
- Process execution only for binaries listed in `profile.allowedProcesses`
- Network access only if `profile.allowNetwork` is `true`

```ts
function generateSbpl(profile: SandboxProfile): string
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `profile` | `SandboxProfile` | The sandbox profile containing read/write paths, allowed processes, and network policy |

**Returns:** A string containing valid SBPL syntax, suitable for writing to a `.sbpl` file.

**Example:**

```ts
import { generateSbpl } from "@mecha/sandbox";

const sbpl = generateSbpl({
  readPaths: ["/usr/local"],
  writePaths: ["/home/user/.mecha/researcher"],
  allowedProcesses: ["/usr/local/bin/node"],
  allowNetwork: false,
});
// => "(version 1)\n(deny default)\n..."
```

#### `escapeSbpl(str)`

Escapes a string for safe inclusion in an SBPL quoted literal. Backslashes are doubled and double quotes are escaped.

```ts
function escapeSbpl(s: string): string
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `s` | `string` | The raw string to escape (typically a filesystem path) |

**Returns:** The escaped string safe for embedding inside SBPL `"..."` literals.

**Example:**

```ts
import { escapeSbpl } from "@mecha/sandbox";

escapeSbpl('/path/with "quotes"');
// => '/path/with \\"quotes\\"'
```

#### `wrapMacos(profilePath, runtimeBin, runtimeArgs, sandboxBin?)`

Wraps a command with macOS `sandbox-exec`. This is a pure function that returns the wrapped command without performing any I/O.

```ts
function wrapMacos(
  profilePath: string,
  runtimeBin: string,
  runtimeArgs: string[],
  sandboxBin?: string,   // default: "sandbox-exec"
): SandboxWrapResult
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `profilePath` | `string` | | Absolute path to the `.sbpl` profile file on disk |
| `runtimeBin` | `string` | | The binary to execute inside the sandbox (e.g. path to `node`) |
| `runtimeArgs` | `string[]` | | Arguments passed to the runtime binary |
| `sandboxBin` | `string` | `"sandbox-exec"` | Path to the `sandbox-exec` binary |

**Returns:** A `SandboxWrapResult` with `bin` set to the sandbox binary and `args` structured as `["-f", profilePath, "--", runtimeBin, ...runtimeArgs]`.

#### `writeProfileMacos(botDir, sbpl)`

Writes an SBPL profile string to `<botDir>/sandbox.sbpl` using an atomic write (write to temp file, then rename). The file is created with mode `0o600` (owner read/write only).

```ts
function writeProfileMacos(botDir: string, sbpl: string): string
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `botDir` | `string` | The bot's root directory |
| `sbpl` | `string` | The SBPL profile content (output of `generateSbpl`) |

**Returns:** The absolute path to the written profile file (`<botDir>/sandbox.sbpl`).

### Linux (`bwrap`)

Linux sandboxing uses [bubblewrap](https://github.com/containers/bubblewrap) (`bwrap`) for namespace-based isolation.

#### `wrapLinux(profile, runtimeBin, runtimeArgs, existsFn?, bwrapBin?)`

Generates bwrap arguments from a `SandboxProfile` and returns the wrapped command. This is a pure function with no I/O.

The generated bwrap invocation:
- Binds `readPaths` as read-only (`--ro-bind`) and `writePaths` as read-write (`--bind`)
- Adds read-only binds for essential system paths (`/usr`, `/lib`, `/lib64`) and specific `/etc` files needed for DNS, NSS, and timezone resolution
- Mounts `/dev`, `/proc`, and a tmpfs `/tmp`
- Masks `/proc/self/environ` (read-only bind to `/dev/null`) to prevent secret exfiltration
- Unshares PID and IPC namespaces (`--unshare-pid`, `--unshare-ipc`)
- Shares or unshares network based on `profile.allowNetwork`
- Does **not** use `--die-with-parent` because bots are long-lived detached processes

::: info
`profile.allowedProcesses` is advisory-only on Linux. Bubblewrap does not enforce per-binary execution restrictions.
:::

```ts
function wrapLinux(
  profile: SandboxProfile,
  runtimeBin: string,
  runtimeArgs: string[],
  existsFn?: (p: string) => boolean,  // default: () => true
  bwrapBin?: string,                  // default: "bwrap"
): SandboxWrapResult
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `profile` | `SandboxProfile` | | The sandbox profile containing paths and network policy |
| `runtimeBin` | `string` | | The binary to execute inside the sandbox |
| `runtimeArgs` | `string[]` | | Arguments passed to the runtime binary |
| `existsFn` | `(p: string) => boolean` | `() => true` | Predicate to check whether system paths exist before binding them |
| `bwrapBin` | `string` | `"bwrap"` | Path to the `bwrap` binary |

**Returns:** A `SandboxWrapResult` with `bin` set to the bwrap binary and `args` containing all namespace, bind-mount, and isolation flags.

### Fallback (no kernel sandbox)

Used on platforms where neither `sandbox-exec` nor `bwrap` is available.

#### `wrapFallback(_profile, runtimeBin, runtimeArgs)`

Returns the original command unchanged (passthrough). Emits a warning to stderr indicating that no OS-level isolation is active.

```ts
function wrapFallback(
  _profile: SandboxProfile,
  runtimeBin: string,
  runtimeArgs: string[],
): SandboxWrapResult
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `_profile` | `SandboxProfile` | The sandbox profile (ignored in fallback mode) |
| `runtimeBin` | `string` | The binary to execute |
| `runtimeArgs` | `string[]` | Arguments passed to the binary |

**Returns:** A `SandboxWrapResult` with `bin` and `args` set to the original command, unmodified.

::: warning
When the fallback wrapper is used, the bot process runs without OS-level isolation. Only process-level restrictions (hooks, environment isolation) are in effect. Use macOS or Linux for kernel sandboxing.
:::

## Types

The `@mecha/sandbox` package exports several TypeScript types used across the sandbox system.

### `SandboxProfile`

Defines the filesystem, process, and network access policy for a sandboxed bot.

```ts
interface SandboxProfile {
  /** Paths the bot can read (files or directories) */
  readPaths: string[];
  /** Paths the bot can write to */
  writePaths: string[];
  /** Executables the bot is allowed to run (enforced on macOS; advisory-only on Linux/fallback) */
  allowedProcesses: string[];
  /** Whether network access is permitted */
  allowNetwork: boolean;
}
```

### `SandboxWrapResult`

The return type of all platform `wrap*` functions.

```ts
interface SandboxWrapResult {
  /** Binary to execute (e.g. "sandbox-exec", "bwrap", or the original binary) */
  bin: string;
  /** Arguments for the binary */
  args: string[];
}
```

### `PersistedSandboxProfile`

The structure written to `<botDir>/sandbox-profile.json` for inspection and debugging. Contains the platform identifier, the full profile, and a creation timestamp.

```ts
interface PersistedSandboxProfile {
  platform: SandboxPlatform;   // "macos" | "linux" | "fallback"
  profile: SandboxProfile;
  createdAt: string;           // ISO 8601 timestamp
}
```

### `ProfileFromConfigOpts`

Options passed to `profileFromConfig()` to generate a `SandboxProfile` from a bot's configuration and directory layout.

```ts
interface ProfileFromConfigOpts {
  config: BotConfig;           // The bot's config.json (from @mecha/core)
  botDir: string;              // Absolute path to the bot's root directory
  mechaDir: string;            // Absolute path to the Mecha data directory (~/.mecha)
  runtimeEntrypoint?: string;  // Path to the runtime entrypoint (used to locate project root)
}
```

`profileFromConfig()` uses these options to compute read paths (Node.js prefix, project root, bot directory, workspace), write paths (bot directory, logs, tmp, workspace), allowed processes (current Node.js binary), and network policy (defaults to `true` unless `config.allowNetwork` is explicitly `false`).

## API Reference

See [@mecha/core API Reference](/reference/api/core#sandbox) for the sandbox types and functions.
