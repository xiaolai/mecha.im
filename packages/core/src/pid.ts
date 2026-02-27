/** Check if a process with the given PID is alive using kill -0. */
export function isPidAlive(pid: number): boolean {
  // Reject non-positive/non-integer PIDs — kill(0) targets process group, kill(-1) targets all
  /* v8 ignore start -- defensive guard: callers always pass valid integer PIDs */
  if (!Number.isInteger(pid) || pid <= 0) return false;
  /* v8 ignore stop */
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    /* v8 ignore start -- EPERM: process exists but owned by different user — can't trigger in test */
    if ((err as NodeJS.ErrnoException).code === "EPERM") return true;
    /* v8 ignore stop */
    // ESRCH: process does not exist; any other error also treated as "gone"
    return false;
  }
}
