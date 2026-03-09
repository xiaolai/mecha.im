import { existsSync, mkdirSync, writeFileSync, rmSync, symlinkSync, statSync, chmodSync, realpathSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";
import { homedir } from "node:os";
import type { BotName } from "@mecha/core";
import { loadNodeIdentity, loadNodePrivateKey, createBotIdentity, BOT_CONFIG_VERSION, resolveAuth, createLogger } from "@mecha/core";
import type { ResolvedAuth } from "@mecha/core";
import { writeHookScripts } from "./hook-scripts.js";
import { buildBotEnv } from "./build-bot-env.js";

export type { BuildBotEnvOpts } from "./build-bot-env.js";
export { buildBotEnv } from "./build-bot-env.js";

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
  // LLM behavior
  systemPrompt?: string;
  appendSystemPrompt?: string;
  effort?: "low" | "medium" | "high";
  maxBudgetUsd?: number;
  // Tool control
  allowedTools?: string[];
  disallowedTools?: string[];
  tools?: string[];
  // Agent identity
  agent?: string;
  agents?: Record<string, { description: string; prompt: string }>;
  // Session behavior
  sessionPersistence?: boolean;
  budgetLimit?: number;
  // MCP & plugins
  mcpServers?: Record<string, unknown>;
  mcpConfigFiles?: string[];
  strictMcpConfig?: boolean;
  pluginDirs?: string[];
  disableSlashCommands?: boolean;
  // Permission overrides
  dangerouslySkipPermissions?: boolean;
  allowDangerouslySkipPermissions?: boolean;
  // Model fallback
  fallbackModel?: string;
  // Environment
  addDirs?: string[];
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

/**
 * Create a symlink at `<homeDir>/.local/bin/claude` pointing to the real claude binary.
 * Claude Code checks `$HOME/.local/bin/claude` at startup — since bot HOME is sandboxed,
 * this symlink prevents the "claude command not found" warning.
 */
function seedClaudeBinSymlink(homeDir: string): void {
  const localBinDir = join(homeDir, ".local", "bin");
  const symlinkPath = join(localBinDir, "claude");

  // Find the real claude binary from the host user's home
  const realHome = homedir();
  const candidates = [
    join(realHome, ".local", "bin", "claude"),
    join(realHome, ".claude", "local", "bin", "claude"),
    "/usr/local/bin/claude",
    "/usr/bin/claude",
  ];
  const realBin = candidates.find((p) => {
    try {
      const st = statSync(p);
      // Verify it's a regular file (or symlink to one) with execute permission
      return st.isFile() && (st.mode & 0o111) !== 0;
    } catch {
      return false;
    }
  });
  /* v8 ignore start -- no claude binary found on host */
  if (!realBin) return;
  /* v8 ignore stop */

  try {
    // Verify parent components are not symlinks before creating directories.
    // Check each intermediate path to prevent symlink-based redirection attacks.
    const resolvedHome = realpathSync(homeDir);
    // Check existing intermediate paths for symlink redirection
    for (const sub of [join(homeDir, ".local"), localBinDir]) {
      if (!existsSync(sub)) continue;
      const resolved = realpathSync(sub);
      /* v8 ignore start -- symlink redirection outside homeDir */
      if (!resolved.startsWith(resolvedHome + "/") && resolved !== resolvedHome) {
        log.warn(`Refusing to create claude symlink: ${sub} resolved outside homeDir`);
        return;
      }
      /* v8 ignore stop */
    }
    mkdirSync(localBinDir, { recursive: true, mode: 0o755 });
    symlinkSync(realBin, symlinkPath);
  } catch (err: unknown) {
    // Tolerate EEXIST (race with concurrent spawn) — any other error is logged but non-fatal
    /* v8 ignore start -- race condition or permission error during symlink creation */
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") {
      log.warn("Failed to create claude symlink", { error: (err as Error).message });
    }
    /* v8 ignore stop */
  }
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
    // Ensure restrictive permissions even if the file pre-existed with looser perms
    chmodSync(credPath, 0o600);
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
  // Enforce absolute, normalized home path (relative paths rejected below)
  const rawHome = opts.home ?? botDir;
  const homeDir = resolve(rawHome);
  if (!isAbsolute(rawHome)) {
    throw new Error(`home must be an absolute path, got: ${rawHome}`);
  }
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

  // Symlink claude binary into bot's HOME so Claude Code finds itself at $HOME/.local/bin/claude.
  // Without this, Claude Code warns "installMethod is native, but claude command not found"
  // because $HOME points to the bot directory, not the real user home.
  seedClaudeBinSymlink(homeDir);

  // Write config
  const config = {
    configVersion: BOT_CONFIG_VERSION, port, token, workspace: workspacePath,
    ...(opts.home != null && { home: opts.home }), model, permissionMode, auth, tags,
    ...(opts.expose != null && { expose: opts.expose }),
    ...(opts.systemPrompt != null && { systemPrompt: opts.systemPrompt }),
    ...(opts.appendSystemPrompt != null && { appendSystemPrompt: opts.appendSystemPrompt }),
    ...(opts.effort != null && { effort: opts.effort }),
    ...(opts.maxBudgetUsd != null && { maxBudgetUsd: opts.maxBudgetUsd }),
    ...(opts.allowedTools != null && { allowedTools: opts.allowedTools }),
    ...(opts.disallowedTools != null && { disallowedTools: opts.disallowedTools }),
    ...(opts.tools != null && { tools: opts.tools }),
    ...(opts.agent != null && { agent: opts.agent }),
    ...(opts.agents != null && { agents: opts.agents }),
    ...(opts.sessionPersistence != null && { sessionPersistence: opts.sessionPersistence }),
    ...(opts.budgetLimit != null && { budgetLimit: opts.budgetLimit }),
    ...(opts.mcpServers != null && { mcpServers: opts.mcpServers }),
    ...(opts.mcpConfigFiles != null && { mcpConfigFiles: opts.mcpConfigFiles }),
    ...(opts.strictMcpConfig != null && { strictMcpConfig: opts.strictMcpConfig }),
    ...(opts.pluginDirs != null && { pluginDirs: opts.pluginDirs }),
    ...(opts.disableSlashCommands != null && { disableSlashCommands: opts.disableSlashCommands }),
    ...(opts.dangerouslySkipPermissions != null && { dangerouslySkipPermissions: opts.dangerouslySkipPermissions }),
    ...(opts.allowDangerouslySkipPermissions != null && { allowDangerouslySkipPermissions: opts.allowDangerouslySkipPermissions }),
    ...(opts.fallbackModel != null && { fallbackModel: opts.fallbackModel }),
    ...(opts.addDirs != null && { addDirs: opts.addDirs }),
    ...(opts.userEnv != null && Object.keys(opts.userEnv).length > 0 && { env: opts.userEnv }),
  };
  writeFileSync(join(botDir, "config.json"), JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });

  // Generate bot identity if node identity exists
  const nodeIdentity = loadNodeIdentity(opts.mechaDir);
  const nodePrivateKey = loadNodePrivateKey(opts.mechaDir);
  /* v8 ignore start -- identity creation tested in integration; unit tests lack node keys */
  if (nodeIdentity && nodePrivateKey) {
    createBotIdentity(botDir, name as BotName, nodeIdentity, nodePrivateKey);
  }
  /* v8 ignore stop */

  // Write sandbox hooks (settings.json + guard scripts)
  writeHookScripts(claudeDir, hooksDir);

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
