import { writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { SandboxProfile, SandboxWrapResult } from "../types.js";

/** Escape a string for safe inclusion in an SBPL quoted literal. */
export function escapeSbpl(s: string): string {
  if (/[\x00-\x1f\x7f]/.test(s)) {
    throw new Error(`Invalid path: contains control characters`);
  }
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Generate a macOS Sandbox Profile Language (.sbpl) string from a SandboxProfile.
 * Pure function — no I/O.
 */
export function generateSbpl(profile: SandboxProfile): string {
  const lines: string[] = [
    "(version 1)",
    "(deny default)",
    // System info, IPC, and runtime requirements
    "(allow sysctl-read)",
    "(allow mach-lookup)",
    "(allow process-fork)",
    "(allow signal)",
    // Unrestricted file reads — Bun compiled binary requires access to paths beyond
    // what can be enumerated (kernel pseudo-filesystems, Apple-internal paths).
    // Security is enforced via file-write* restrictions and process-exec restrictions.
    "(allow file-read*)",
    // Bun's child_process.spawn opens /dev/null for stdio fds set to "ignore".
    // Without this, posix_spawn fails with EPERM inside the sandbox (R7-001).
    '(allow file-write* (literal "/dev/null"))',
  ];

  if (profile.allowNetwork) {
    lines.push("(allow network*)");
  }

  // readPaths are intentionally unused — covered by unrestricted file-read* above.
  // The field exists in SandboxProfile for other platforms (e.g., Linux seccomp).
  // Write access is explicitly restricted to specific paths.
  for (const p of profile.writePaths) {
    lines.push(`(allow file-write* (subpath "${escapeSbpl(p)}"))`);
  }

  // Allow executing only specified processes (no global process-exec)
  for (const p of profile.allowedProcesses) {
    lines.push(`(allow process-exec (literal "${escapeSbpl(p)}"))`);
  }

  return lines.join("\n") + "\n";
}

/**
 * Wrap a command for macOS sandbox-exec.
 * Pure function — returns the wrapped command.
 */
export function wrapMacos(
  profilePath: string,
  runtimeBin: string,
  runtimeArgs: string[],
  sandboxBin = "sandbox-exec",
): SandboxWrapResult {
  return {
    bin: sandboxBin,
    args: ["-f", profilePath, "--", runtimeBin, ...runtimeArgs],
  };
}

/**
 * Write a .sbpl profile to botDir/sandbox.sbpl (atomic write).
 */
export function writeProfileMacos(botDir: string, sbpl: string): string {
  const profilePath = join(botDir, "sandbox.sbpl");
  const tmp = profilePath + `.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, sbpl, { mode: 0o600 });
  renameSync(tmp, profilePath);
  return profilePath;
}
