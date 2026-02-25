/** Platform identifier for sandbox implementations */
export type SandboxPlatform = "macos" | "linux" | "fallback";

/** Filesystem access paths for a sandboxed CASA */
export interface SandboxProfile {
  /** Paths the CASA can read (files or directories) */
  readPaths: string[];
  /** Paths the CASA can write to */
  writePaths: string[];
  /** Executables the CASA is allowed to run (enforced on macOS; advisory-only on Linux/fallback) */
  allowedProcesses: string[];
  /** Whether network access is permitted */
  allowNetwork: boolean;
}

/** Result of wrapping a command with sandbox enforcement */
export interface SandboxWrapResult {
  /** Binary to execute (e.g. "sandbox-exec", "bwrap", or original binary) */
  bin: string;
  /** Arguments for the binary */
  args: string[];
}

/** Persisted sandbox profile written to casaDir/sandbox-profile.json */
export interface PersistedSandboxProfile {
  platform: SandboxPlatform;
  profile: SandboxProfile;
  createdAt: string;
}

/** Sandbox API — created via createSandbox() */
export interface Sandbox {
  /** Detected platform */
  platform: SandboxPlatform;
  /** Whether kernel sandbox is available on this platform */
  isAvailable(): boolean;
  /** Wrap a command with sandbox enforcement */
  wrap(profile: SandboxProfile, runtimeBin: string, runtimeArgs: string[], casaDir: string): Promise<SandboxWrapResult>;
  /** Human-readable description of sandbox state */
  describe(): string;
}
