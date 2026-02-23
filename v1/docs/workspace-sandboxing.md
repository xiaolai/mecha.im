# Workspace Sandboxing & Rule Inheritance

> Architecture guide for running CASA (Claude Agent SDK App) instances as sandboxed processes — no containers required.

## Overview

Each Mecha is a sandboxed Claude Code process. Isolation is provided by the OS-level sandbox built into Claude Code CLI, not by Docker containers. This eliminates the container lifecycle entirely while preserving filesystem and network isolation.

```
mecha up ./project-alpha
  → spawns a sandboxed Claude Code process
  → filesystem restricted to ./project-alpha/
  → conversation history stored locally
  → inherits shared rules from parent workspace
```

## Why Not Containers

| Concern | Docker | Sandboxed Process |
|---|---|---|
| Filesystem isolation | Container namespace | OS sandbox (Seatbelt / bubblewrap) |
| Startup time | Seconds (image pull + create) | Instant |
| Dependencies | Docker Engine required | None (built into Claude Code) |
| Port management | Docker port mapping | Direct localhost ports |
| Cleanup | `docker rm -f` | `process.kill()` |
| Security boundary | Docker socket = root access | No elevated privileges |
| Code complexity | Docker client + lifecycle mgmt | `child_process.spawn` |
| Debugging | `docker exec`, `docker logs` | Direct stdout/stderr |

Filesystem isolation — preventing the agent from accessing files outside its project directory — is the only isolation requirement. Claude Code's built-in sandbox handles this natively.

## Platform Support

| Platform | Sandbox Mechanism | Status |
|---|---|---|
| macOS | Apple Seatbelt (`sandbox-exec`) | Supported |
| Linux | bubblewrap (`bwrap`) | Supported |
| WSL2 | bubblewrap (`bwrap`) | Supported |

All platforms use POSIX paths (`/forward/slashes`). No cross-platform path parsing needed.

Claude Code does not run natively on Windows — Windows users use WSL2, where sandboxing works via bubblewrap.

---

## Workspace Layout

```
my-mechas/                              ← workspace root
├── .git                                ← walk-up boundary for rule loading
├── .claude/
│   ├── CLAUDE.md                       ← shared instructions (all CASAs inherit)
│   └── rules/
│       ├── security.md                 ← shared rule
│       ├── style.md                    ← shared rule
│       └── api-guidelines.md           ← shared rule
│
├── project-alpha/                      ← CASA-alpha's project directory
│   ├── .claude/
│   │   ├── CLAUDE.md                   ← project-specific instructions
│   │   └── rules/
│   │       ├── local.md                ← project-specific rule
│   │       └── security.md → ../../.claude/rules/security.md  ← symlink
│   ├── .mecha/                         ← CASA-alpha's data (CLAUDE_CONFIG_DIR)
│   │   ├── settings.json
│   │   ├── .claude.json
│   │   └── projects/                   ← conversation history
│   └── src/                            ← project source code
│
└── project-beta/                       ← CASA-beta's project directory
    ├── .claude/
    │   ├── CLAUDE.md
    │   └── rules/
    │       ├── local.md
    │       └── security.md → ../../.claude/rules/security.md
    ├── .mecha/
    └── src/
```

### Key directories

| Path | Purpose | Created by |
|---|---|---|
| `my-mechas/.git` | Stops rule walk-up at workspace root | `git init` (once) |
| `my-mechas/.claude/` | Shared rules inherited by all CASAs | User |
| `project-x/.claude/` | Project-specific rules | User |
| `project-x/.mecha/` | CASA data, history, settings | `mecha up` |

---

## Rule Inheritance

### How Claude Code loads rules

Claude Code walks **up** from the working directory toward the filesystem root, loading every `.claude/` directory it finds. It stops at the nearest `.git` root.

```
project-alpha/.claude/rules/     ← loaded first (highest priority)
my-mechas/.claude/rules/         ← loaded second (lower priority)
── .git ──                       ← walk-up stops here
```

Closer (deeper) rules override farther (shallower) ones when they conflict.

### Shared rules via symlinks

To give a CASA access to shared rules while keeping it sandboxed:

```bash
# Inside project-alpha/.claude/rules/
ln -sf ../../.claude/rules/security.md security.md
ln -sf ../../.claude/rules/style.md style.md
```

**Why this works:**

1. Rule loading happens at **Claude Code startup**, by the runtime itself
2. The sandbox restricts **agent tool actions** at runtime
3. The runtime follows symlinks during init → shared rules load
4. The agent cannot follow symlinks during execution → isolation preserved

**Inheritance without escape.**

### Selective inheritance

Not every CASA needs every shared rule. Symlink only what you want:

```
my-mechas/.claude/rules/
├── security.md          ← symlinked by all projects
├── style.md             ← symlinked by frontend projects only
├── api-guidelines.md    ← symlinked by backend projects only
└── experimental.md      ← not symlinked by any — opt-in only
```

### Priority resolution

When the same filename exists at multiple levels:

```
my-mechas/.claude/rules/security.md       ← "use HTTPS"
project-alpha/.claude/rules/security.md   ← "allow HTTP for localhost"
```

The project-level rule wins for CASA-alpha. The shared rule applies to any CASA that doesn't override it.

### CLAUDE.md inheritance

The same walk-up applies to `CLAUDE.md` files:

```
my-mechas/CLAUDE.md               ← shared project instructions
project-alpha/CLAUDE.md           ← project-specific instructions
```

Both are loaded. Project-level instructions take priority on conflicts.

---

## Conversation History Isolation

### The problem

Without configuration, all Claude Code instances store data in `~/.claude/`. Multiple CASAs would share the same conversation history, settings, and project state.

### The solution: `CLAUDE_CONFIG_DIR`

Setting `CLAUDE_CONFIG_DIR` redirects all Claude Code data to a custom directory:

```bash
CLAUDE_CONFIG_DIR=./project-alpha/.mecha claude ...
```

This moves everything out of `~/.claude/`:

| Data | Default location | With CLAUDE_CONFIG_DIR |
|---|---|---|
| Conversation history | `~/.claude/projects/` | `./project-alpha/.mecha/projects/` |
| Settings | `~/.claude/settings.json` | `./project-alpha/.mecha/settings.json` |
| OAuth/tokens | `~/.claude/.claude.json` | `./project-alpha/.mecha/.claude.json` |
| Memory | `~/.claude/CLAUDE.md` | `./project-alpha/.mecha/CLAUDE.md` |

Each CASA's data is fully isolated, stored next to its project.

### Temporary files

Use `CLAUDE_CODE_TMPDIR` for temporary file isolation:

```bash
CLAUDE_CODE_TMPDIR=./project-alpha/.mecha/tmp claude ...
```

---

## Sandbox Configuration

### Enabling the sandbox

Per-CASA `settings.json` at `<CLAUDE_CONFIG_DIR>/settings.json`:

```json
{
  "sandbox": {
    "enabled": true,
    "autoAllowBashIfSandboxed": true,
    "allowUnsandboxedCommands": false
  }
}
```

| Setting | Value | Effect |
|---|---|---|
| `enabled` | `true` | OS-level sandbox active |
| `autoAllowBashIfSandboxed` | `true` | Sandboxed commands run without prompts |
| `allowUnsandboxedCommands` | `false` | Eliminates the escape hatch entirely |

### Filesystem restrictions

With sandbox enabled:
- **Write access**: working directory and subdirectories only
- **Read access**: filesystem (minus explicitly denied paths)

Additional restrictions via permission rules:

```json
{
  "permissions": {
    "deny": [
      "Read(~/.ssh/**)",
      "Read(~/.aws/**)",
      "Read(//.env)"
    ]
  }
}
```

### Network restrictions

```json
{
  "sandbox": {
    "network": {
      "allowedDomains": [
        "api.anthropic.com",
        "*.npmjs.org",
        "github.com"
      ],
      "allowLocalBinding": false,
      "allowAllUnixSockets": false
    }
  }
}
```

### Permission modes

Set via CLI flag or `settings.json`:

| Mode | Use case |
|---|---|
| `default` | Interactive — prompts on first tool use |
| `plan` | Read-only analysis — no modifications |
| `dontAsk` | Autonomous — auto-deny unless pre-approved |
| `bypassPermissions` | Fully autonomous — skip all checks (sandboxed environments only) |

For autonomous CASA operation:

```bash
claude --permission-mode bypassPermissions --sandbox ...
```

The sandbox provides the safety net; `bypassPermissions` removes the interactive prompts.

---

## Launching a CASA

### Full launch command

```bash
CLAUDE_CONFIG_DIR=./project-alpha/.mecha \
CLAUDE_CODE_TMPDIR=./project-alpha/.mecha/tmp \
  claude \
    --permission-mode dontAsk \
    --sandbox \
    --add-dir ./project-alpha \
    "$@"
```

### What `mecha up` does

```
1. Validate project path exists
2. Create .mecha/ directory if needed
3. Symlink shared rules into project's .claude/rules/
4. Write per-CASA settings.json to .mecha/
5. Spawn Claude Code process:
   - Set CLAUDE_CONFIG_DIR → .mecha/
   - Set CLAUDE_CODE_TMPDIR → .mecha/tmp/
   - Enable sandbox
   - Set permission mode
   - Set cwd to project directory
6. Record PID + assigned port
7. Pipe stdout/stderr for log streaming
```

### What `mecha down` does

```
1. Look up PID for the project
2. Send SIGTERM to the process
3. Wait for graceful shutdown (timeout → SIGKILL)
4. Clean up PID record
```

### What `mecha ls` does

```
1. List all tracked PIDs
2. Check which are still alive
3. Report: project path, PID, port, uptime, state
```

---

## Core Runtime

The entire process manager is minimal:

```typescript
import { spawn, ChildProcess } from "node:child_process";
import { join } from "node:path";

interface MechaProcess {
  id: string;
  projectPath: string;
  port: number;
  pid: number;
  process: ChildProcess;
  state: "running" | "stopped" | "errored";
}

function mechaUp(projectPath: string, port: number): MechaProcess {
  const mechaDir = join(projectPath, ".mecha");
  const proc = spawn("claude", ["--sandbox", "--permission-mode", "dontAsk"], {
    cwd: projectPath,
    env: {
      ...process.env,
      CLAUDE_CONFIG_DIR: mechaDir,
      CLAUDE_CODE_TMPDIR: join(mechaDir, "tmp"),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  return {
    id: generateId(),
    projectPath,
    port,
    pid: proc.pid!,
    process: proc,
    state: "running",
  };
}

function mechaDown(mecha: MechaProcess): void {
  mecha.process.kill("SIGTERM");
  mecha.state = "stopped";
}
```

No Docker client. No image builds. No container lifecycle. No port mapping. No volume mounts. No network configuration.

---

## Comparison: Before vs After

| Aspect | Docker-based | Sandbox-based |
|---|---|---|
| Dependencies | Docker Engine | None |
| Startup time | 2-10 seconds | < 1 second |
| Isolation | Container namespace | OS sandbox |
| Rule inheritance | Volume mounts / copy | Walk-up + symlinks |
| History storage | Container volume | `CLAUDE_CONFIG_DIR` |
| Port management | Docker port mapping | Direct port flag |
| Log streaming | `docker logs -f` | stdout/stderr pipe |
| Cleanup | `docker rm -f` | `process.kill()` |
| Debugging | `docker exec -it` | Direct process |
| Codebase | ~2000+ lines | ~200 lines |
| Cross-platform paths | POSIX only (Linux containers) | POSIX only (all supported platforms) |

---

## Security Model

### What the sandbox prevents

- Agent writing files outside the project directory
- Agent reading sensitive paths (`~/.ssh`, `~/.aws`, etc. — if denied)
- Agent making network requests to non-allowlisted domains
- Agent executing unsandboxed commands (if `allowUnsandboxedCommands: false`)

### What the sandbox does NOT prevent

- The Claude Code runtime reading files during startup (rule loading, config)
- The spawning process (`mecha up`) accessing the filesystem
- Inter-CASA communication via localhost network (by design)

### Trust boundary

```
Trusted:
  └── mecha CLI (spawns processes, manages lifecycle)
      └── Claude Code runtime (loads rules, applies sandbox)

Untrusted (sandboxed):
  └── AI agent actions (file reads/writes, bash commands, network)
```

The agent operates inside the sandbox. Everything above the sandbox line is trusted infrastructure.

---

## Gitignore

Add to your workspace `.gitignore`:

```gitignore
# CASA runtime data (conversation history, settings, temp files)
**/.mecha/
```

Shared rules and project configuration (`.claude/`) should be committed. Runtime data (`.mecha/`) should not.
