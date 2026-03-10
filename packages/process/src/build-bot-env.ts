import { resolveAuth, MeterProxyRequiredError, AuthProfileNotFoundError, ProcessSpawnError, createLogger } from "@mecha/core";
import type { ResolvedAuth } from "@mecha/core";
import { execFileSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { readProxyInfo, isPidAlive, meterDir } from "@mecha/meter";

const log = createLogger("mecha:process");

/** Cached claude CLI path — resolved once per process. */
let cachedClaudePath: string | undefined | null = null; // null = not yet resolved

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
    "MECHA_AUTH_TOKEN", "MECHA_LOG_DIR", "MECHA_SANDBOX_ROOT", "MECHA_DIR", "MECHA_CLAUDE_PATH", "HOME", "TMPDIR",
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
    // Block reserved keys (case-insensitive for Windows compat) and bash function exports
    if (reservedKeys.has(k.toUpperCase()) || /^BASH_FUNC_.*%%$/.test(k)) continue;
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
            ...(process.platform === "darwin" ? ["/opt/homebrew/bin"] : []),
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
    // Also rethrow non-"not found" errors (corruption, permission) to surface real issues.
    /* v8 ignore start -- fallback for environments without auth profiles */
    if (opts.auth !== undefined) throw err;
    if (!(err instanceof AuthProfileNotFoundError)) throw err;
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

  // Fail fast if no API credentials are available from any source.
  // Skip when auth is explicitly null (--no-auth) — user opted out of credentials.
  if (opts.auth !== null && !childEnv["ANTHROPIC_API_KEY"] && !childEnv["CLAUDE_CODE_OAUTH_TOKEN"]) {
    throw new ProcessSpawnError(
      `No API credentials available for bot "${name}". ` +
      `Set ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN in the environment, ` +
      `or add an auth profile with: mecha auth add`,
    );
  }

  // Resolve claude CLI path in the parent process (before sandbox restricts PATH)
  // and pass it to the child so the Agent SDK can spawn it.
  // Cached per process to avoid repeated execFileSync calls.
  /* v8 ignore start -- claude path resolution */
  if (cachedClaudePath === null) {
    try {
      const resolved = execFileSync("which", ["claude"], { encoding: "utf-8" }).trim();
      if (resolved) {
        // Verify the path is executable (not a dangling symlink or inaccessible)
        try {
          accessSync(resolved, constants.X_OK);
          cachedClaudePath = resolved;
        } catch {
          log.warn("claude CLI found but not executable", { path: resolved });
          cachedClaudePath = undefined;
        }
      } else {
        cachedClaudePath = undefined;
      }
    } catch {
      cachedClaudePath = undefined;
    }
  }
  if (cachedClaudePath) childEnv["MECHA_CLAUDE_PATH"] = cachedClaudePath;
  /* v8 ignore stop */

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
    } else {
      log.warn("Meter proxy not configured — bot API usage will not be tracked. Start meter with: mecha meter start");
    }
  }

  return childEnv;
}
