import type { ChildProcess } from "node:child_process";

// Re-export from canonical source in @mecha/core
export { isPidAlive } from "@mecha/core";

export function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    /* v8 ignore start -- exit code already set when child exits synchronously */
    if (child.exitCode !== null && child.exitCode !== undefined) {
      resolve(true);
      return;
    }
    /* v8 ignore stop */
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

export function waitForPidExit(pid: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      try {
        process.kill(pid, 0);
        if (Date.now() - start > timeoutMs) {
          resolve();
          return;
        }
        setTimeout(check, 100);
      } catch (err) {
        // EPERM: process alive but different user — keep polling
        if ((err as NodeJS.ErrnoException).code === "EPERM") {
          if (Date.now() - start > timeoutMs) {
            resolve();
            return;
          }
          setTimeout(check, 100);
          return;
        }
        // ESRCH or other: process gone
        resolve();
      }
    };
    check();
  });
}
