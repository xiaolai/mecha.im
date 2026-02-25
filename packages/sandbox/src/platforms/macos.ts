import { writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { SandboxProfile, SandboxWrapResult } from "../types.js";

/** Escape a string for safe inclusion in an SBPL quoted literal. */
export function escapeSbpl(s: string): string {
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
    // Allow sysctl for basic system info
    "(allow sysctl-read)",
    // Allow mach lookups for system services
    "(allow mach-lookup)",
  ];

  if (profile.allowNetwork) {
    lines.push("(allow network*)");
  }

  // Allow read access
  for (const p of profile.readPaths) {
    lines.push(`(allow file-read* (subpath "${escapeSbpl(p)}"))`);
  }

  // Allow write access (implies read)
  for (const p of profile.writePaths) {
    lines.push(`(allow file-read* (subpath "${escapeSbpl(p)}"))`);
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
 * Write a .sbpl profile to casaDir/sandbox.sbpl (atomic write).
 */
export function writeProfileMacos(casaDir: string, sbpl: string): string {
  const profilePath = join(casaDir, "sandbox.sbpl");
  const tmp = profilePath + `.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, sbpl, { mode: 0o600 });
  renameSync(tmp, profilePath);
  return profilePath;
}
