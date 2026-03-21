// Types
export type {
  SandboxPlatform,
  SandboxProfile,
  SandboxWrapResult,
  PersistedSandboxProfile,
  Sandbox,
} from "./types.js";

// Sandbox factory
export { createSandbox, detectPlatform, checkAvailability } from "./sandbox.js";

// Profile generation
export { profileFromConfig } from "./profile.js";
export type { ProfileFromConfigOpts } from "./profile.js";

// Platform implementations (for direct use / testing)
export { generateSbpl, escapeSbpl, wrapMacos, writeProfileMacos } from "./platforms/macos.js";
export { wrapLinux } from "./platforms/linux.js";
export { wrapFallback } from "./platforms/fallback.js";
