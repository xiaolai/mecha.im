import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const PID_FILE = "daemon.pid";

/** Read the daemon PID from daemon.pid. Returns null if missing or corrupt. */
export function readDaemonPid(mechaDir: string): number | null {
  try {
    const content = readFileSync(join(mechaDir, PID_FILE), "utf-8");
    const raw = content.split("\n")[0]!.trim();
    if (!/^\d+$/.test(raw)) return null;
    const pid = Number(raw);
    if (!Number.isSafeInteger(pid) || pid <= 0) return null;
    return pid;
  /* v8 ignore start -- only ENOENT expected in normal operation */
  } catch {
    return null;
  }
  /* v8 ignore stop */
}

/** Write the daemon PID to daemon.pid with mode 0o600. Includes a marker for identity verification. */
export function writeDaemonPid(mechaDir: string, pid: number): void {
  mkdirSync(mechaDir, { recursive: true });
  writeFileSync(join(mechaDir, PID_FILE), `${pid}\nmecha-daemon\n`, { mode: 0o600 });
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

/** Check if a daemon process is currently running and is actually a mecha daemon. */
export function isDaemonRunning(mechaDir: string): boolean {
  const pid = readDaemonPid(mechaDir);
  if (pid === null) return false;
  // Verify the PID file contains our marker (prevents signaling unrelated processes)
  try {
    const raw = readFileSync(join(mechaDir, PID_FILE), "utf-8");
    const lines = raw.trim().split("\n");
    if (lines[1] !== "mecha-daemon") return false;
  /* v8 ignore start -- ENOENT race is harmless */
  } catch {
    return false;
  }
  /* v8 ignore stop */
  try {
    process.kill(pid, 0);
    return true;
  /* v8 ignore start -- ESRCH expected when process is dead */
  } catch {
    return false;
  }
  /* v8 ignore stop */
}
