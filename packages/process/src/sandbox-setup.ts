import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { BotName } from "@mecha/core";
import { loadNodeIdentity, loadNodePrivateKey, createBotIdentity, BOT_CONFIG_VERSION, resolveAuth, MeterProxyRequiredError, createLogger } from "@mecha/core";
import type { ResolvedAuth } from "@mecha/core";
import { readProxyInfo, isPidAlive, meterDir } from "@mecha/meter";

const log = createLogger("mecha:process");

export interface BotFilesystemOpts {
  botDir: string;
  workspacePath: string;
  port: number;
  token: string;
  name: string;
  mechaDir: string;
  model?: string;
  permissionMode?: string;
  auth?: string | null;
  tags?: string[];
  expose?: string[];
  userEnv?: Record<string, string>;
  meterOff?: boolean;
  home?: string;
}

export interface BotFilesystemResult {
  homeDir: string;
  tmpDir: string;
  logsDir: string;
  projectsDir: string;
  childEnv: Record<string, string>;
}

/**
 * Encode a workspace path into a directory name matching Claude Code's convention.
 * Replaces `/`, `\`, `:`, and `.` with `-`.
 * `/home/user/my.project` → `-home-alice-my-project`
 * `C:\Users\joker\project` → `C-home-alice-project`
 */
export function encodeProjectPath(workspacePath: string): string {
  return workspacePath.replace(/[/\\:.]/g, "-");
}

/** Options for building bot environment variables. */
export interface BuildBotEnvOpts {
  botDir: string;
  homeDir: string;
  tmpDir: string;
  logsDir: string;
  projectsDir: string;
  workspacePath: string;
  port: number;
  token: string;
  name: string;
  mechaDir: string;
  auth?: string | null;
  userEnv?: Record<string, string>;
  meterOff?: boolean;
}

/**
 * Build the sandboxed environment for a bot process or PTY session.
 * Single source of truth for bot env construction — used by both
 * prepareBotFilesystem (spawn) and the PTY manager (terminal attach).
 */
export function buildBotEnv(opts: BuildBotEnvOpts): Record<string, string> {
  const { botDir, homeDir, tmpDir, logsDir, projectsDir, workspacePath, port, token, name, userEnv } = opts;

  const resolvedUserEnv = userEnv ?? {};
  const reservedKeys = new Set([
    "MECHA_BOT_NAME", "MECHA_PORT", "MECHA_WORKSPACE", "MECHA_PROJECTS_DIR",
    "MECHA_AUTH_TOKEN", "MECHA_LOG_DIR", "MECHA_SANDBOX_ROOT", "MECHA_DIR", "HOME", "TMPDIR",
    // Block PATH (we construct our own), shell startup vars, and dangerous Node.js/linker env vars
    "PATH", "BASH_ENV", "ENV",
    "NODE_OPTIONS", "NODE_PATH", "NODE_DEBUG", "NODE_EXTRA_CA_CERTS", "NODE_REDIRECT_WARNINGS",
    "NODE_V8_COVERAGE", "NODE_PROF",
    "LD_PRELOAD", "LD_LIBRARY_PATH", "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH",
    // Block SDK auth keys — auth resolution sets the correct one
    "ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN",
    // Block metering URL — set by meter proxy integration
    "ANTHROPIC_BASE_URL",
  ]);
  const safeUserEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(resolvedUserEnv)) {
    // Block reserved keys and bash function exports (BASH_FUNC_*%%)
    if (reservedKeys.has(k) || /^BASH_FUNC_.*%%$/.test(k)) continue;
    safeUserEnv[k] = v;
  }
  const childEnv: Record<string, string> = {
    /* v8 ignore start -- construct minimal PATH: node binary dir + standard system paths */
    PATH: process.platform === "win32"
      ? [
          ...(process.execPath ? [process.execPath.replace(/[/\\][^/\\]+$/, "")] : []),
          "C:\\Windows\\system32",
          "C:\\Windows",
        ].join(";")
      : [
          ...new Set([
            ...(process.execPath ? [process.execPath.replace(/\/[^/]+$/, "")] : []),
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
          ]),
        ].join(":"),
    /* v8 ignore stop */
    ...safeUserEnv,
    HOME: homeDir,
    TMPDIR: tmpDir,
    MECHA_BOT_NAME: name,
    MECHA_PORT: String(port),
    MECHA_WORKSPACE: workspacePath,
    MECHA_PROJECTS_DIR: projectsDir,
    MECHA_AUTH_TOKEN: token,
    MECHA_LOG_DIR: logsDir,
    MECHA_SANDBOX_ROOT: botDir,
    MECHA_DIR: opts.mechaDir,
  };

  // Resolve auth profile → inject correct SDK env var
  let resolved: ResolvedAuth | null = null;
  try {
    resolved = resolveAuth(opts.mechaDir, opts.auth);
  } catch (err) {
    // Only fall back to host env when no profiles exist (implicit auth).
    // If user explicitly passed --auth <name>, rethrow so spawn fails fast.
    /* v8 ignore start -- fallback for environments without auth profiles */
    if (opts.auth !== undefined) throw err;
    log.warn("No auth profiles found, inheriting host credentials. Use --auth <name> or create a profile with 'mecha auth add' for explicit auth.");
    const sdkKeys = ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"] as const;
    for (const key of sdkKeys) {
      if (process.env[key] && !childEnv[key]) {
        childEnv[key] = process.env[key]!;
      }
    }
    /* v8 ignore stop */
  }
  if (resolved) {
    childEnv[resolved.envVar] = resolved.token;
  }

  // Meter proxy integration — set ANTHROPIC_BASE_URL if proxy is alive
  if (!opts.meterOff) {
    const md = meterDir(opts.mechaDir);
    const proxyInfo = readProxyInfo(md);
    if (proxyInfo) {
      if (isPidAlive(proxyInfo.pid)) {
        childEnv["ANTHROPIC_BASE_URL"] = `http://127.0.0.1:${proxyInfo.port}/bot/${name}`;
      } else if (proxyInfo.required) {
        throw new MeterProxyRequiredError();
      } else {
        log.warn("Meter proxy is not running (stale proxy.json), skipping metering");
      }
    }
  }

  return childEnv;
}

/**
 * Seed Claude Code auth files so the CLI finds valid credentials on first launch.
 * Writes `.claude/.credentials.json` (OAuth) or relies on ANTHROPIC_API_KEY env var (API key).
 * Also seeds `.claude.json` with onboarding state to skip the first-run wizard.
 * Always overwrites credentials so auth profile changes take effect on next spawn.
 */
function seedClaudeCredentials(
  homeDir: string,
  claudeDir: string,
  mechaDir: string,
  auth?: string | null,
): void {
  // Seed onboarding state to skip first-run wizard
  const claudeJsonPath = join(homeDir, ".claude.json");
  if (!existsSync(claudeJsonPath)) {
    const onboardingState = {
      numStartups: 1,
      hasCompletedOnboarding: true,
      installMethod: "manual",
      autoUpdates: false,
      firstStartTime: new Date().toISOString(),
    };
    writeFileSync(claudeJsonPath, JSON.stringify(onboardingState, null, 2) + "\n", { mode: 0o600 });
  }

  // Resolve auth to get the token for credentials seeding
  let resolved: ResolvedAuth | null = null;
  try {
    resolved = resolveAuth(mechaDir, auth);
  } catch {
    // Auth resolution failed — no credentials to seed.
    // buildBotEnv will handle the fallback (inherit host env or throw).
    return;
  }
  if (!resolved) return;

  // Seed credentials based on auth type.
  // Always overwrite — ensures PATCH /bots/:name/config with new auth profile
  // takes effect on next spawn instead of using stale credentials.
  const credPath = join(claudeDir, ".credentials.json");
  if (resolved.type === "oauth") {
    const credentials = {
      claudeAiOauth: {
        accessToken: resolved.token,
        // Set far-future expiry — the token is managed by mecha auth profiles
        expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
        scopes: ["user:inference", "user:profile", "user:sessions:claude_code"],
      },
    };
    writeFileSync(credPath, JSON.stringify(credentials) + "\n", { mode: 0o600 });
  } else {
    // Non-OAuth (api-key): remove stale OAuth credentials if they exist.
    // API key auth works via env var alone — leftover .credentials.json could
    // cause Claude Code to use the wrong auth method.
    if (existsSync(credPath)) rmSync(credPath);
  }
}

export function prepareBotFilesystem(opts: BotFilesystemOpts): BotFilesystemResult {
  const { botDir, workspacePath, port, token, name, model, permissionMode, auth, tags, userEnv } = opts;

  // Create directory structure mirroring real Claude Code
  const homeDir = opts.home ?? botDir;
  const claudeDir = join(homeDir, ".claude");
  const hooksDir = join(claudeDir, "hooks");
  const projectsBaseDir = join(claudeDir, "projects");
  const encodedPath = encodeProjectPath(workspacePath);
  const projectsDir = join(projectsBaseDir, encodedPath);
  const tmpDir = join(botDir, "tmp");
  const logsDir = join(botDir, "logs");

  mkdirSync(hooksDir, { recursive: true, mode: 0o700 });
  mkdirSync(projectsDir, { recursive: true, mode: 0o700 });
  mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
  mkdirSync(logsDir, { recursive: true, mode: 0o700 });

  // Write config
  const config = { configVersion: BOT_CONFIG_VERSION, port, token, workspace: workspacePath, ...(opts.home != null && { home: opts.home }), model, permissionMode, auth, tags, expose: opts.expose };
  writeFileSync(join(botDir, "config.json"), JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });

  // Generate bot identity if node identity exists
  const nodeIdentity = loadNodeIdentity(opts.mechaDir);
  const nodePrivateKey = loadNodePrivateKey(opts.mechaDir);
  /* v8 ignore start -- identity creation tested in integration; unit tests lack node keys */
  if (nodeIdentity && nodePrivateKey) {
    createBotIdentity(botDir, name as BotName, nodeIdentity, nodePrivateKey);
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
  // Use Node.js one-liner for JSON parsing (no jq dependency, no grep/sed injection risk)
  const sandboxGuard = `#!/bin/bash
# Sandbox guard: block file access outside bot root
# Claude Code PreToolUse hooks receive JSON on stdin with tool_name + tool_input
INPUT=$(cat)
# Parse JSON structurally via Node.js to extract the path field
TARGET=$(echo "$INPUT" | node -e "
  const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
  const i=d.tool_input||{};
  const p=i.file_path||i.path||i.directory||'';
  process.stdout.write(String(p));
" 2>/dev/null)
if [ -z "$TARGET" ]; then
  exit 2  # No path extracted — deny by default (fail-closed)
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
# Bash guard: validate Bash tool calls
# Claude Code PreToolUse hooks receive JSON on stdin with tool_input.command
# Exit 0 = allow command as-is, Exit 2 = block
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | node -e "
  const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
  const i=d.tool_input||{};
  process.stdout.write(String(i.command||''));
" 2>/dev/null)
if [ -z "$COMMAND" ]; then
  exit 2  # No command extracted — deny by default (fail-closed)
fi
# Canonicalize allowed roots
SANDBOX=$(realpath -m "$MECHA_SANDBOX_ROOT" 2>/dev/null || echo "$MECHA_SANDBOX_ROOT")
WORKSPACE=$(realpath -m "$MECHA_WORKSPACE" 2>/dev/null || echo "$MECHA_WORKSPACE")
# Block commands that explicitly reference paths outside sandbox/workspace
# Extract file path arguments from the command
# Use process substitution to avoid subshell — exit 2 exits the main script
while read -r FPATH; do
  RESOLVED=$(realpath -m "$FPATH" 2>/dev/null || echo "$FPATH")
  case "$RESOLVED" in
    "$SANDBOX"/*|"$SANDBOX") ;;
    "$WORKSPACE"/*|"$WORKSPACE") ;;
    /usr/*|/bin/*|/etc/*|/dev/*|/tmp/*|/System/*|/lib/*|/lib64/*) ;;
    *) echo "BLOCKED: $RESOLVED is outside sandbox" >&2; exit 2 ;;
  esac
done < <(echo "$COMMAND" | grep -oE '((/|\\.\\./|\\./)([^ ;"'"'"'|&>]*))')
exit 0
`;
  writeFileSync(join(hooksDir, "sandbox-guard.sh"), sandboxGuard, { mode: 0o755 });
  writeFileSync(join(hooksDir, "bash-guard.sh"), bashGuard, { mode: 0o755 });

  // Seed Claude Code credentials so the CLI picks up auth without browser login.
  // Always overwrites on auth change; removes stale OAuth creds when switching to API key.
  seedClaudeCredentials(homeDir, claudeDir, opts.mechaDir, auth);

  // Build environment using shared function
  const childEnv = buildBotEnv({
    botDir, homeDir, tmpDir, logsDir, projectsDir, workspacePath,
    port, token, name, mechaDir: opts.mechaDir, auth, userEnv,
    meterOff: opts.meterOff,
  });

  return { homeDir, tmpDir, logsDir, projectsDir, childEnv };
}
