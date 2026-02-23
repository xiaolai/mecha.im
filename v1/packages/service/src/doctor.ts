import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DoctorResultType } from "@mecha/contracts";

const execFileAsync = promisify(execFile);

// --- mechaDoctor ---
export async function mechaDoctor(): Promise<DoctorResultType> {
  const issues: string[] = [];
  let claudeCliAvailable = false;
  let sandboxSupported = false;

  // Check Claude CLI
  try {
    await execFileAsync("claude", ["--version"]);
    claudeCliAvailable = true;
  } catch {
    issues.push("Claude CLI not found. Install it from https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview");
  }

  // Check sandbox support (macOS sandbox-exec, Linux seccomp)
  if (process.platform === "darwin") {
    try {
      await execFileAsync("sandbox-exec", ["-p", "(version 1)(allow default)", "/usr/bin/true"]);
      sandboxSupported = true;
    } catch {
      issues.push("macOS sandbox (sandbox-exec) not available.");
    }
  } else if (process.platform === "linux") {
    // On Linux, sandboxing via seccomp/namespaces is generally available
    sandboxSupported = true;
  } else {
    issues.push(`Sandbox not supported on platform: ${process.platform}`);
  }

  return { claudeCliAvailable, sandboxSupported, issues };
}
