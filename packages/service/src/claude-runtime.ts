import { existsSync, accessSync, constants as fsConstants } from "node:fs";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";

export type ResolvedFrom = "local-bin" | "claude-local" | "usr-local" | "usr-bin" | "path" | "not-found";

export interface ClaudeRuntimeInfo {
  /** Resolved absolute path to the claude binary, or null if not found. */
  binPath: string | null;
  /** Version string (e.g. "2.1.70"), or null if binary not found or version check failed. */
  version: string | null;
  /** How the binary was found. */
  resolvedFrom: ResolvedFrom;
}

const CANDIDATES: { path: string; label: ResolvedFrom }[] = [
  { path: join(homedir(), ".local", "bin", "claude"), label: "local-bin" },
  { path: join(homedir(), ".claude", "local", "bin", "claude"), label: "claude-local" },
  { path: "/usr/local/bin/claude", label: "usr-local" },
  { path: "/usr/bin/claude", label: "usr-bin" },
];

function isExecutable(filePath: string): boolean {
  try {
    accessSync(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function getVersionAsync(binPath: string): Promise<string | null> {
  return new Promise((resolve) => {
    // execFile is safe — binPath is from hardcoded CANDIDATES or `which` output, never user input.
    execFile(binPath, ["--version"], { timeout: 5_000 }, (err, stdout) => {
      if (err) { resolve(null); return; }
      const output = stdout.trim();
      const match = /^([\d.]+)/.exec(output);
      resolve(match?.[1] ?? output);
    });
  });
}

function whichAsync(cmd: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("which", [cmd], { timeout: 3_000 }, (err, stdout) => {
      if (err) { resolve(null); return; }
      const result = stdout.trim();
      resolve(result || null);
    });
  });
}

/** Cache: resolved once, reused for 5 minutes. */
let cached: { info: ClaudeRuntimeInfo; expiresAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60_000;

/**
 * Resolves the Claude Code binary path, version, and install method.
 * Searches known locations in priority order, then falls back to PATH.
 * Results are cached for 5 minutes to avoid blocking the event loop on repeated calls.
 */
export async function resolveClaudeRuntime(): Promise<ClaudeRuntimeInfo> {
  if (cached && Date.now() < cached.expiresAt) {
    return cached.info;
  }

  // Check hardcoded candidates — require existence AND executability
  for (const { path, label } of CANDIDATES) {
    if (existsSync(path) && isExecutable(path)) {
      const version = await getVersionAsync(path);
      const info: ClaudeRuntimeInfo = { binPath: path, version, resolvedFrom: label };
      cached = { info, expiresAt: Date.now() + CACHE_TTL_MS };
      return info;
    }
  }

  // Fallback: try bare "claude" on PATH
  const whichResult = await whichAsync("claude");
  if (whichResult) {
    const version = await getVersionAsync(whichResult);
    const info: ClaudeRuntimeInfo = { binPath: whichResult, version, resolvedFrom: "path" };
    cached = { info, expiresAt: Date.now() + CACHE_TTL_MS };
    return info;
  }

  const info: ClaudeRuntimeInfo = { binPath: null, version: null, resolvedFrom: "not-found" };
  cached = { info, expiresAt: Date.now() + CACHE_TTL_MS };
  return info;
}

/** Invalidate the cached runtime info (e.g. after a tool install). */
export function invalidateClaudeRuntimeCache(): void {
  cached = null;
}
