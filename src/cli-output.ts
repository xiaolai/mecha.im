/**
 * CLI output utilities: color, spinners, status formatting.
 * Respects NO_COLOR env var and --no-color flag.
 */

import pc from "picocolors";

// Re-export picocolors so all CLI code imports from one place
export { pc };

export function statusColor(status: string): string {
  switch (status) {
    case "running": return pc.green(status);
    case "exited":
    case "stopped": return pc.yellow(status);
    case "error":
    case "dead": return pc.red(status);
    default: return pc.dim(status);
  }
}

export function botName(name: string): string {
  return pc.cyan(name);
}

export function success(msg: string): string {
  return pc.green("✓") + " " + msg;
}

export function error(msg: string): string {
  return pc.red("✗") + " " + msg;
}

export function hint(msg: string): string {
  return pc.dim("  Hint: " + msg);
}

export function dim(msg: string): string {
  return pc.dim(msg);
}

export async function withSpinner<T>(label: string, fn: () => Promise<T>): Promise<T> {
  // Dynamic import to handle ESM ora
  const { default: ora } = await import("ora");
  const spinner = ora(label).start();
  try {
    const result = await fn();
    spinner.succeed();
    return result;
  } catch (err) {
    spinner.fail();
    throw err;
  }
}
