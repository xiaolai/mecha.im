import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CasaName } from "@mecha/core";
import { loadNodeIdentity, loadNodePrivateKey, createCasaIdentity } from "@mecha/core";

export interface CasaFilesystemOpts {
  casaDir: string;
  workspacePath: string;
  port: number;
  token: string;
  name: string;
  mechaDir: string;
  model?: string;
  permissionMode?: string;
  auth?: string;
  tags?: string[];
  expose?: string[];
  userEnv?: Record<string, string>;
}

export interface CasaFilesystemResult {
  homeDir: string;
  tmpDir: string;
  logsDir: string;
  projectsDir: string;
  childEnv: Record<string, string>;
}

/**
 * Encode a workspace path into a directory name matching Claude Code's convention.
 * `/home/user/my-project` → `-home-alice-my-project`
 */
export function encodeProjectPath(workspacePath: string): string {
  return workspacePath.replace(/\//g, "-");
}

export function prepareCasaFilesystem(opts: CasaFilesystemOpts): CasaFilesystemResult {
  const { casaDir, workspacePath, port, token, name, model, permissionMode, auth, tags, userEnv } = opts;

  // Create directory structure mirroring real Claude Code
  const homeDir = join(casaDir, "home");
  const claudeDir = join(homeDir, ".claude");
  const hooksDir = join(claudeDir, "hooks");
  const projectsBaseDir = join(claudeDir, "projects");
  const encodedPath = encodeProjectPath(workspacePath);
  const projectsDir = join(projectsBaseDir, encodedPath);
  const tmpDir = join(casaDir, "tmp");
  const logsDir = join(casaDir, "logs");

  mkdirSync(hooksDir, { recursive: true, mode: 0o700 });
  mkdirSync(projectsDir, { recursive: true, mode: 0o700 });
  mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
  mkdirSync(logsDir, { recursive: true, mode: 0o700 });

  // Write config
  const config = { port, token, workspace: workspacePath, model, permissionMode, auth, tags, expose: opts.expose };
  writeFileSync(join(casaDir, "config.json"), JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });

  // Generate CASA identity if node identity exists
  const nodeIdentity = loadNodeIdentity(opts.mechaDir);
  const nodePrivateKey = loadNodePrivateKey(opts.mechaDir);
  /* v8 ignore start -- identity creation tested in integration; unit tests lack node keys */
  if (nodeIdentity && nodePrivateKey) {
    createCasaIdentity(casaDir, name as CasaName, nodeIdentity, nodePrivateKey);
  }
  /* v8 ignore stop */

  // Write sandbox hooks (settings.json)
  const settings = {
    hooks: {
      PreToolUse: [
        {
          matcher: "Read|Write|Edit|Glob|Grep",
          hooks: [{
            type: "command",
            command: "$HOME/.claude/hooks/sandbox-guard.sh",
            timeout: 5,
          }],
        },
        {
          matcher: "Bash",
          hooks: [{
            type: "command",
            command: "$HOME/.claude/hooks/bash-guard.sh",
            timeout: 5,
          }],
        },
      ],
    },
  };
  writeFileSync(join(claudeDir, "settings.json"), JSON.stringify(settings, null, 2) + "\n");

  // Write hook scripts — hooks receive JSON on stdin per Claude Code PreToolUse spec
  const sandboxGuard = `#!/bin/bash
# Sandbox guard: block file access outside CASA root
# Claude Code PreToolUse hooks receive JSON on stdin with tool_name + tool_input
INPUT=$(cat)
# Extract the path from tool_input (handles Read, Write, Edit, Glob, Grep)
TARGET=$(echo "$INPUT" | grep -o '"\\(file_path\\|path\\|pattern\\|directory\\)"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\\([^"]*\\)"$/\\1/')
if [ -z "$TARGET" ]; then
  exit 0  # No path argument — allow (e.g. Glob with only pattern)
fi
# Canonicalize target path, following symlinks
RESOLVED=$(realpath -m "$TARGET" 2>/dev/null || (cd "$(dirname "$TARGET")" 2>/dev/null && pwd)/$(basename "$TARGET"))
# Canonicalize allowed roots
SANDBOX=$(realpath -m "$MECHA_SANDBOX_ROOT" 2>/dev/null || echo "$MECHA_SANDBOX_ROOT")
WORKSPACE=$(realpath -m "$MECHA_WORKSPACE" 2>/dev/null || echo "$MECHA_WORKSPACE")
case "$RESOLVED" in
  "$SANDBOX"/*|"$SANDBOX") exit 0 ;;
  "$WORKSPACE"/*|"$WORKSPACE") exit 0 ;;
  *) echo "BLOCKED: $RESOLVED is outside sandbox" >&2; exit 2 ;;
esac
`;
  const bashGuard = `#!/bin/bash
# Bash guard: enforce workspace context for Bash tool calls
# Claude Code PreToolUse hooks receive JSON on stdin with tool_input.command
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\\([^"]*\\)"$/\\1/')
if [ -z "$COMMAND" ]; then
  exit 0
fi
# Prefix command with cd to workspace (output on stdout tells Claude Code to use this)
echo "cd \\"$MECHA_WORKSPACE\\" && $COMMAND"
`;
  writeFileSync(join(hooksDir, "sandbox-guard.sh"), sandboxGuard, { mode: 0o755 });
  writeFileSync(join(hooksDir, "bash-guard.sh"), bashGuard, { mode: 0o755 });

  // Build environment — user env goes in the middle, security vars last to prevent override
  const resolvedUserEnv = userEnv ?? {};
  const reservedKeys = new Set([
    "MECHA_CASA_NAME", "MECHA_PORT", "MECHA_WORKSPACE", "MECHA_PROJECTS_DIR",
    "MECHA_AUTH_TOKEN", "MECHA_LOG_DIR", "MECHA_SANDBOX_ROOT", "MECHA_DIR", "HOME", "TMPDIR",
  ]);
  const safeUserEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(resolvedUserEnv)) {
    if (!reservedKeys.has(k)) safeUserEnv[k] = v;
  }
  const childEnv: Record<string, string> = {
    /* v8 ignore start -- PATH always set in normal environments */
    PATH: process.env.PATH ?? "",
    /* v8 ignore stop */
    ...safeUserEnv,
    HOME: homeDir,
    TMPDIR: tmpDir,
    MECHA_CASA_NAME: name,
    MECHA_PORT: String(port),
    MECHA_WORKSPACE: workspacePath,
    MECHA_PROJECTS_DIR: projectsDir,
    MECHA_AUTH_TOKEN: token,
    MECHA_LOG_DIR: logsDir,
    MECHA_SANDBOX_ROOT: casaDir,
    MECHA_DIR: opts.mechaDir,
  };

  // Forward SDK auth keys from parent env when not already set
  const sdkKeys = ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"] as const;
  for (const key of sdkKeys) {
    if (process.env[key] && !childEnv[key]) {
      childEnv[key] = process.env[key]!;
    }
  }

  return { homeDir, tmpDir, logsDir, projectsDir, childEnv };
}
