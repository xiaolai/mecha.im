import { mkdirSync, writeFileSync, symlinkSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export interface CasaFilesystemOpts {
  casaDir: string;
  workspacePath: string;
  port: number;
  token: string;
  name: string;
  model?: string;
  permissionMode?: string;
  auth?: string;
  userEnv?: Record<string, string>;
}

export interface CasaFilesystemResult {
  homeDir: string;
  tmpDir: string;
  logsDir: string;
  sessionsDir: string;
  childEnv: Record<string, string>;
}

export function prepareCasaFilesystem(opts: CasaFilesystemOpts): CasaFilesystemResult {
  const { casaDir, workspacePath, port, token, name, model, permissionMode, auth, userEnv } = opts;

  // Create directory structure
  const homeDir = join(casaDir, "home");
  const claudeDir = join(homeDir, ".claude");
  const hooksDir = join(claudeDir, "hooks");
  const workDir = join(casaDir, "workspace");
  const tmpDir = join(casaDir, "tmp");
  const sessionsDir = join(casaDir, "sessions");
  const logsDir = join(casaDir, "logs");

  mkdirSync(hooksDir, { recursive: true, mode: 0o700 });
  mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
  mkdirSync(sessionsDir, { recursive: true, mode: 0o700 });
  mkdirSync(logsDir, { recursive: true, mode: 0o700 });

  // Create workspace symlink — remove existing if present, then create fresh
  try { unlinkSync(workDir); } catch { /* no existing symlink */ }
  symlinkSync(workspacePath, workDir);

  // Write config
  const config = { port, token, workspace: workspacePath, model, permissionMode, auth };
  writeFileSync(join(casaDir, "config.json"), JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });

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

  // Write hook scripts
  const sandboxGuard = `#!/bin/bash
# Sandbox guard: block file access outside CASA root
TARGET="$1"
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
# Bash guard: ensure commands run in workspace context
cd "$MECHA_WORKSPACE" 2>/dev/null || true
`;
  writeFileSync(join(hooksDir, "sandbox-guard.sh"), sandboxGuard, { mode: 0o755 });
  writeFileSync(join(hooksDir, "bash-guard.sh"), bashGuard, { mode: 0o755 });

  // Build environment — user env goes in the middle, security vars last to prevent override
  const resolvedUserEnv = userEnv ?? {};
  const reservedKeys = new Set([
    "MECHA_CASA_NAME", "MECHA_PORT", "MECHA_WORKSPACE", "MECHA_DB_PATH",
    "MECHA_AUTH_TOKEN", "MECHA_LOG_DIR", "MECHA_SANDBOX_ROOT", "HOME", "TMPDIR",
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
    MECHA_DB_PATH: join(casaDir, "sessions", "sessions.db"),
    MECHA_AUTH_TOKEN: token,
    MECHA_LOG_DIR: logsDir,
    MECHA_SANDBOX_ROOT: casaDir,
  };

  return { homeDir, tmpDir, logsDir, sessionsDir, childEnv };
}
