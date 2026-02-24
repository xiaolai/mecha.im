import { ProcessHealthTimeoutError } from "@mecha/contracts";

/**
 * Poll GET /healthz on a CASA runtime until it responds 200
 * or the timeout is reached. Uses exponential backoff starting
 * at 100ms, capped at 1000ms.
 */
export async function waitForHealthy(
  port: number,
  token: string,
  timeoutMs: number = 10_000,
  casaName: string = "unknown",
): Promise<void> {
  const start = Date.now();
  let delay = 100;

  while (Date.now() - start < timeoutMs) {
    try {
      const remaining = timeoutMs - (Date.now() - start);
      const attemptTimeout = Math.min(2000, Math.max(remaining, 500));
      const res = await fetch(`http://127.0.0.1:${port}/healthz`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(attemptTimeout),
      });
      if (res.ok) return;
    } catch {
      // connection refused or timeout — retry
    }
    await sleep(delay);
    delay = Math.min(delay * 2, 1000);
  }

  throw new ProcessHealthTimeoutError(casaName);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
