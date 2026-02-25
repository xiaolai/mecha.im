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
  return {
    bin: runtimeBin,
    args: runtimeArgs,
  };
}
