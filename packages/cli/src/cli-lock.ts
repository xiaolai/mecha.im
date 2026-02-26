import { readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const LOCK_FILE = "cli.lock";

export interface CliLockInfo {
  pid: number;
  startedAt: string;
}

/** Read the CLI lock file. Returns null if missing or corrupt. */
export function readCliLock(mechaDir: string): CliLockInfo | null {
  try {
    const raw = readFileSync(join(mechaDir, LOCK_FILE), "utf-8");
    const info = JSON.parse(raw) as CliLockInfo;
    if (typeof info.pid !== "number" || typeof info.startedAt !== "string") {
      return null;
    }
    return info;
  } catch {
    return null;
  }
}

/** Check if a PID is alive. */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    /* v8 ignore start -- EPERM means process exists but different user; treat as alive */
    if ((err as NodeJS.ErrnoException).code === "EPERM") return true;
    /* v8 ignore stop */
    return false;
  }
}

/**
 * Acquire the CLI singleton lock.
 * Returns true if lock acquired, false if another CLI instance is running.
 * Cleans stale locks from dead processes automatically.
 */
export function acquireCliLock(mechaDir: string): boolean {
  const existing = readCliLock(mechaDir);
  if (existing && isPidAlive(existing.pid)) {
    return false;
  }

  // Write lock file atomically (tmp + rename)
  mkdirSync(mechaDir, { recursive: true });
  const target = join(mechaDir, LOCK_FILE);
  const tmp = target + ".tmp";
  const info: CliLockInfo = { pid: process.pid, startedAt: new Date().toISOString() };
  writeFileSync(tmp, JSON.stringify(info, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, target);
  return true;
}

/**
 * Commands that mutate state and need the singleton lock.
 * Read-only commands (ls, status, logs, cost, etc.) skip the lock
 * so users can inspect the system while a long-running command is active.
 */
const EXCLUSIVE_COMMANDS = new Set([
  "spawn", "stop", "kill", "init", "configure",
  "agent",  // agent start/stop
]);

/**
 * Commands nested under a parent that need the lock.
 * Format: "parent subcommand"
 */
const EXCLUSIVE_SUBCOMMANDS = new Set([
  "meter start", "meter stop",
  "schedule add", "schedule remove", "schedule pause", "schedule resume", "schedule run",
  "acl grant", "acl revoke",
  "node add", "node rm",
  "auth add", "auth rm", "auth set-default",
  "budget set", "budget rm",
]);

/**
 * Check if the current argv requires the singleton lock.
 * Returns true for mutating commands, false for read-only ones.
 */
export function needsLock(argv: string[]): boolean {
  // Strip node/binary path — find the first non-flag argument(s)
  const args = argv.slice(2).filter((a) => !a.startsWith("-"));
  if (args.length === 0) return false; // --help, --version

  const cmd = args[0]!;
  if (EXCLUSIVE_COMMANDS.has(cmd)) return true;

  if (args.length >= 2) {
    const sub = `${cmd} ${args[1]}`;
    if (EXCLUSIVE_SUBCOMMANDS.has(sub)) return true;
  }

  return false;
}

/** Release the CLI singleton lock. Only removes if the lock belongs to this process. */
export function releaseCliLock(mechaDir: string): void {
  const info = readCliLock(mechaDir);
  if (info && info.pid === process.pid) {
    try {
      unlinkSync(join(mechaDir, LOCK_FILE));
    } catch {
      /* v8 ignore start -- best-effort cleanup, ENOENT race is harmless */
    }
    /* v8 ignore stop */
  }
}
