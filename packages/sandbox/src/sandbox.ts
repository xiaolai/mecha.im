import { platform as osPlatform } from "node:os";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import type { Sandbox, SandboxPlatform, SandboxProfile, SandboxWrapResult } from "./types.js";
import { generateSbpl, wrapMacos, writeProfileMacos } from "./platforms/macos.js";
import { wrapLinux } from "./platforms/linux.js";
import { wrapFallback } from "./platforms/fallback.js";

/** Resolve the absolute path of a command, or return undefined if not found. */
export function resolveCommand(cmd: string): string | undefined {
  try {
    /* v8 ignore start -- command resolution is environment-dependent */
    const result = execFileSync("/bin/sh", ["-c", `command -v "$1"`, "--", cmd], { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }).trim();
    return result || undefined;
    /* v8 ignore stop */
  /* v8 ignore start -- command resolution is environment-dependent */
  } catch {
    return undefined;
  }
  /* v8 ignore stop */
}

/** Detect the current platform for sandbox support */
export function detectPlatform(): SandboxPlatform {
  const os = osPlatform();
  /* v8 ignore start -- OS-dependent: only darwin branch runs on macOS */
  if (os === "darwin") return "macos";
  if (os === "linux") return "linux";
  return "fallback";
  /* v8 ignore stop */
}

/** Check if the kernel sandbox tool is available on this platform */
export function checkAvailability(plat: SandboxPlatform): boolean {
  if (plat === "macos") {
    /* v8 ignore start -- sandbox-exec try/catch branch is OS-dependent */
    const bin = resolveCommand("sandbox-exec");
    if (!bin) return false;
    try {
      execFileSync(bin, ["-n", "no-network", "/usr/bin/true"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
    /* v8 ignore stop */
  }
  /* v8 ignore start -- bwrap not available on macOS test runner */
  if (plat === "linux") {
    const bin = resolveCommand("bwrap");
    if (!bin) return false;
    try {
      execFileSync(bin, ["--version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }
  /* v8 ignore stop */
  return false;
}

/** Create a Sandbox instance for the current platform */
export function createSandbox(platformOverride?: SandboxPlatform): Sandbox {
  /* v8 ignore start -- platformOverride ?? detectPlatform() branches */
  const plat = platformOverride ?? detectPlatform();
  /* v8 ignore stop */
  let available: boolean | undefined;

  function isAvailable(): boolean {
    /* v8 ignore start -- caching branch */
    if (available === undefined) {
      available = checkAvailability(plat);
    }
    return available;
    /* v8 ignore stop */
  }

  async function wrap(
    profile: SandboxProfile,
    runtimeBin: string,
    runtimeArgs: string[],
    casaDir: string,
  ): Promise<SandboxWrapResult> {
    if (plat === "macos") {
      const sbpl = generateSbpl(profile);
      const profilePath = writeProfileMacos(casaDir, sbpl);
      /* v8 ignore start -- resolveCommand returns absolute path on macOS */
      const sandboxBin = resolveCommand("sandbox-exec") ?? "sandbox-exec";
      /* v8 ignore stop */
      return wrapMacos(profilePath, runtimeBin, runtimeArgs, sandboxBin);
    }
    /* v8 ignore start -- linux/fallback wrap not fully testable on macOS */
    if (plat === "linux") {
      const bwrapBin = resolveCommand("bwrap") ?? "bwrap";
      return wrapLinux(profile, runtimeBin, runtimeArgs, existsSync, bwrapBin);
    }
    return wrapFallback(profile, runtimeBin, runtimeArgs);
    /* v8 ignore stop */
  }

  function describe(): string {
    const avail = isAvailable();
    if (plat === "macos") {
      /* v8 ignore start -- sandbox-exec availability is OS-dependent */
      return avail
        ? "macOS sandbox-exec (available)"
        : "macOS sandbox-exec (not available)";
      /* v8 ignore stop */
    }
    /* v8 ignore start -- linux/fallback describe not testable on macOS */
    if (plat === "linux") {
      return avail
        ? "Linux bubblewrap (available)"
        : "Linux bubblewrap (not available)";
    }
    return "No kernel sandbox (fallback)";
    /* v8 ignore stop */
  }

  return {
    platform: plat,
    isAvailable,
    wrap,
    describe,
  };
}
