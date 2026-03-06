import type { BotName } from "@mecha/core";
import type { ProcessManager } from "@mecha/process";
import { runtimeFetch } from "./helpers.js";

/** Result of checking whether a bot is busy with active sessions. */
export interface TaskCheckResult {
  busy: boolean;
  activeSessions: number;
  lastActivity?: string;
}

/**
 * Check if a bot has recently active sessions.
 * Returns busy: true when sessions have been updated within `recencyMs`.
 * Fails open (returns busy: false) when the bot is not running or unreachable.
 */
export async function checkBotBusy(
  pm: ProcessManager,
  name: BotName,
  recencyMs = 60_000,
): Promise<TaskCheckResult> {
  const info = pm.get(name);
  if (!info || info.state !== "running") {
    return { busy: false, activeSessions: 0 };
  }

  try {
    const result = await runtimeFetch(pm, name, "/api/sessions");
    const sessions = result.body as Array<{ updatedAt?: string }>;
    /* v8 ignore start -- defensive: runtime always returns array */
    if (!Array.isArray(sessions)) {
      return { busy: false, activeSessions: 0 };
    }
    /* v8 ignore stop */

    const now = Date.now();
    const recent = sessions.filter((s) =>
      s.updatedAt != null && now - new Date(s.updatedAt).getTime() < recencyMs,
    );

    if (recent.length === 0) {
      return { busy: false, activeSessions: 0 };
    }

    // One-pass max by parsed epoch to avoid lexicographic sort issues
    let maxEpoch = 0;
    let lastActivity = recent[0]!.updatedAt!;
    for (const s of recent) {
      const epoch = new Date(s.updatedAt!).getTime();
      if (epoch > maxEpoch) {
        maxEpoch = epoch;
        lastActivity = s.updatedAt!;
      }
    }

    return {
      busy: true,
      activeSessions: recent.length,
      lastActivity,
    };
  } catch {
    /* v8 ignore start -- fail open: unreachable runtime should not block lifecycle ops */
    return { busy: false, activeSessions: 0 };
    /* v8 ignore stop */
  }
}
