import type { SandboxProfile, SandboxWrapResult } from "../types.js";

/** Essential system paths to bind read-only if they exist. */
const SYSTEM_RO_BINDS = ["/usr", "/lib", "/lib64"];

/** Specific /etc files needed for DNS resolution and NSS (not all of /etc). */
const ETC_RO_FILES = [
  "/etc/resolv.conf",
  "/etc/hosts",
  "/etc/nsswitch.conf",
  "/etc/ssl/certs",
  "/etc/ca-certificates",
  "/etc/passwd",     // needed by Node.js os.userInfo()
  "/etc/localtime",  // timezone
];

/**
 * Generate bwrap (bubblewrap) arguments from a SandboxProfile.
 * Pure function — no I/O.
 *
 * Critical: NO --die-with-parent (bots are long-lived detached processes).
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

  // Specific /etc files (not all of /etc — prevents host config/secret exposure)
  for (const p of ETC_RO_FILES) {
    if (existsFn(p)) {
      args.push("--ro-bind", p, p);
    }
  }

  // Device filesystem (needed for Node.js)
  args.push("--dev", "/dev");
  // Mount /proc read-only — restrict to minimum needed entries
  // Note: bwrap --proc creates a new /proc mount; add --ro-bind for specific entries
  args.push("--proc", "/proc");
  // Mask sensitive /proc entries to prevent secret exfiltration via /proc/self/environ
  args.push("--ro-bind", "/dev/null", "/proc/self/environ");

  // Tmpfs for /tmp (separate from bot tmp)
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
