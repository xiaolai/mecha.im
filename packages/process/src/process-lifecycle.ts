import type { ChildProcess } from "node:child_process";
import { checkPort } from "./port.js";

// Re-export from canonical source in @mecha/core
export { isPidAlive } from "@mecha/core";

/** Wait for a child process to exit. Returns true if exited, false if timeout. */
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

/** Wait for a TCP port to become free. Returns true if free, false if timeout. */
export function waitForPortFree(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const poll = async () => {
      if (await checkPort(port)) {
        resolve(true);
        return;
      }
      /* v8 ignore start -- polling timeout and retry require real port lifecycle */
      if (Date.now() - start > timeoutMs) {
        resolve(false);
        return;
      }
      setTimeout(poll, 200);
      /* v8 ignore stop */
    };
    poll();
  });
}

/** Wait for a process to exit. Returns true if process exited, false if timeout. */
export function waitForPidExit(pid: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      try {
        process.kill(pid, 0);
        if (Date.now() - start > timeoutMs) {
          resolve(false); // Timeout — process still alive
          return;
        }
        setTimeout(check, 100);
      } catch (err) {
        // EPERM: process alive but different user — keep polling
        if ((err as NodeJS.ErrnoException).code === "EPERM") {
          if (Date.now() - start > timeoutMs) {
            resolve(false); // Timeout — process still alive (different user)
            return;
          }
          setTimeout(check, 100);
          return;
        }
        // ESRCH or other: process gone
        resolve(true);
      }
    };
    check();
  });
}
