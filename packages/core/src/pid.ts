/** Check if a process with the given PID is alive using kill -0. */
export function isPidAlive(pid: number): boolean {
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
