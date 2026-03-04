import type { SandboxProfile, SandboxWrapResult } from "../types.js";

/**
 * Fallback platform — no kernel sandbox available.
 * Returns the original command unchanged (passthrough).
 */
export function wrapFallback(
  _profile: SandboxProfile,
  runtimeBin: string,
  runtimeArgs: string[],
): SandboxWrapResult {
  console.warn("[mecha:sandbox] WARNING: No kernel sandbox available on this platform. bot process runs without OS-level isolation. Use macOS (sandbox-exec) or Linux (bubblewrap) for kernel sandboxing.");
  return {
    bin: runtimeBin,
    args: runtimeArgs,
  };
}
