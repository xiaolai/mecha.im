import type { SandboxProfile, SandboxWrapResult } from "../types.js";

/** Essential system paths to bind read-only if they exist. */
const SYSTEM_RO_BINDS = ["/usr", "/lib", "/lib64", "/etc"];

/**
 * Generate bwrap (bubblewrap) arguments from a SandboxProfile.
 * Pure function — no I/O.
 *
 * Critical: NO --die-with-parent (CASAs are long-lived detached processes).
 * Uses --ro-bind for read paths, --bind for write paths.
 * Note: allowedProcesses is advisory-only on Linux (not enforced by bwrap).
 */
export function wrapLinux(
  profile: SandboxProfile,
  runtimeBin: string,
  runtimeArgs: string[],
  existsFn: (p: string) => boolean = () => true,
  bwrapBin = "bwrap",
): SandboxWrapResult {
  const args: string[] = [];

  // Read-only binds
  for (const p of profile.readPaths) {
    args.push("--ro-bind", p, p);
  }

  // Read-write binds
  for (const p of profile.writePaths) {
    args.push("--bind", p, p);
  }

  // Essential system paths (read-only, only if they exist)
  for (const p of SYSTEM_RO_BINDS) {
    if (existsFn(p)) {
      args.push("--ro-bind", p, p);
    }
  }

  // Device and proc filesystems (needed for Node.js)
  args.push("--dev", "/dev");
  args.push("--proc", "/proc");

  // Tmpfs for /tmp (separate from CASA tmp)
  args.push("--tmpfs", "/tmp");

  if (profile.allowNetwork) {
    args.push("--share-net");
  } else {
    args.push("--unshare-net");
  }

  // Unshare PID and IPC namespaces
  args.push("--unshare-pid");
  args.push("--unshare-ipc");

  // The command to run
  args.push("--", runtimeBin, ...runtimeArgs);

  return {
    bin: bwrapBin,
    args,
  };
}
