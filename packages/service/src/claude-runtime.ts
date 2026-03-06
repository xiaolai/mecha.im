import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";

export interface ClaudeRuntimeInfo {
  /** Resolved absolute path to the claude binary, or null if not found. */
  binPath: string | null;
  /** Version string (e.g. "2.1.70"), or null if binary not found or version check failed. */
  version: string | null;
  /** How the binary was found: "local-bin", "claude-local", "usr-local", "usr-bin", "path", or "not-found". */
  resolvedFrom: string;
}

const CANDIDATES: { path: string; label: string }[] = [
  { path: join(homedir(), ".local", "bin", "claude"), label: "local-bin" },
  { path: join(homedir(), ".claude", "local", "bin", "claude"), label: "claude-local" },
  { path: "/usr/local/bin/claude", label: "usr-local" },
  { path: "/usr/bin/claude", label: "usr-bin" },
];

function getVersion(binPath: string): string | null {
  try {
    // execFileSync is safe here — binPath is from our hardcoded CANDIDATES or `which` output,
    // never from user input. execFile does not invoke a shell.
    const output = execFileSync(binPath, ["--version"], {
      timeout: 5_000,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    // Output is like "2.1.70 (Claude Code)" — extract the version number
    const match = /^([\d.]+)/.exec(output);
    return match?.[1] ?? output;
  } catch {
    return null;
  }
}

/**
 * Resolves the Claude Code binary path, version, and install method.
 * Searches known locations in priority order, then falls back to PATH.
 */
export function resolveClaudeRuntime(): ClaudeRuntimeInfo {
  for (const { path, label } of CANDIDATES) {
    if (existsSync(path)) {
      return { binPath: path, version: getVersion(path), resolvedFrom: label };
    }
  }

  // Fallback: try bare "claude" on PATH via `which`
  try {
    const whichResult = execFileSync("which", ["claude"], {
      timeout: 3_000,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (whichResult) {
      return { binPath: whichResult, version: getVersion(whichResult), resolvedFrom: "path" };
    }
  } catch {
    // not on PATH
  }

  return { binPath: null, version: null, resolvedFrom: "not-found" };
}
