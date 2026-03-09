import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const PID_FILE = "daemon.pid";

/** Read the daemon PID from daemon.pid. Returns null if missing or corrupt. */
export function readDaemonPid(mechaDir: string): number | null {
  try {
    const raw = readFileSync(join(mechaDir, PID_FILE), "utf-8").trim();
    const pid = parseInt(raw, 10);
    if (!Number.isSafeInteger(pid) || pid <= 0) return null;
    return pid;
  /* v8 ignore start -- only ENOENT expected in normal operation */
  } catch {
    return null;
  }
  /* v8 ignore stop */
}

/** Write the daemon PID to daemon.pid with mode 0o600. */
export function writeDaemonPid(mechaDir: string, pid: number): void {
  mkdirSync(mechaDir, { recursive: true });
  writeFileSync(join(mechaDir, PID_FILE), String(pid) + "\n", { mode: 0o600 });
}

/** Remove the daemon.pid file. Ignores errors if missing. */
export function removeDaemonPid(mechaDir: string): void {
  try {
    unlinkSync(join(mechaDir, PID_FILE));
  /* v8 ignore start -- ENOENT race is harmless */
  } catch {
    // ignore
  }
  /* v8 ignore stop */
}

/** Check if a daemon process is currently running. */
export function isDaemonRunning(mechaDir: string): boolean {
  const pid = readDaemonPid(mechaDir);
  if (pid === null) return false;
  try {
    process.kill(pid, 0);
    return true;
  /* v8 ignore start -- ESRCH expected when process is dead */
  } catch {
    return false;
  }
  /* v8 ignore stop */
}
