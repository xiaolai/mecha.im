import { join } from "node:path";
import type { BotName } from "@mecha/core";
import { isValidName, readBotConfig } from "@mecha/core";
import type { ProcessManager, ProcessInfo } from "@mecha/process";
import { checkBotBusy } from "./task-check.js";

export interface BatchItemResult {
  name: string;
  status: "succeeded" | "skipped_busy" | "skipped_stopped" | "failed";
  error?: string;
  activeSessions?: number;
  lastActivity?: string;
}

export interface BatchResult {
  results: BatchItemResult[];
  summary: { succeeded: number; skipped: number; failed: number };
}

export interface BatchActionOpts {
  pm: ProcessManager;
  mechaDir: string;
  action: "stop" | "restart";
  force?: boolean;
  /** Skip busy bots silently (counted as skipped). Without this, busy bots are counted as failed. */
  idleOnly?: boolean;
  dryRun?: boolean;
  concurrency?: number;
  /** Limit operation to specific bot names. When omitted, targets all bots. */
  names?: string[];
  onProgress?: (result: BatchItemResult) => void;
}

interface Candidate {
  info: ProcessInfo;
  busy: boolean;
  activeSessions: number;
  lastActivity?: string;
}

/**
 * Run a batch stop/restart across all bots.
 * Returns per-bot results with a summary.
 *
 * Busy-check semantics:
 * - `force`: bypass busy check entirely
 * - `idleOnly`: skip busy bots silently (counted as skipped, not failed)
 * - default: busy bots are counted as failed (operation refused)
 *
 * Note: TOCTOU between busy check and stop/kill is inherent to the domain.
 * A bot can become busy after the check. This is acceptable — the alternative
 * (holding a lock) would be worse for a local-first system.
 */
export async function batchBotAction(opts: BatchActionOpts): Promise<BatchResult> {
  const { pm, mechaDir, action, force, idleOnly, dryRun, names, onProgress } = opts;
  const concurrency = Math.max(1, Math.floor(opts.concurrency ?? 4));
  let all = pm.list().filter((p) => isValidName(p.name));
  if (names && names.length > 0) {
    const nameSet = new Set(names);
    all = all.filter((p) => nameSet.has(p.name));
  }
  const results: BatchItemResult[] = [];

  // Collect candidates — run busy checks with bounded parallelism
  const candidates: Candidate[] = [];
  const toCheck: ProcessInfo[] = [];

  for (const info of all) {
    if (action === "stop" && info.state !== "running") {
      const r: BatchItemResult = { name: info.name, status: "skipped_stopped" };
      results.push(r);
      onProgress?.(r);
      continue;
    }
    if (info.state === "running" && !force) {
      toCheck.push(info);
    } else {
      candidates.push({ info, busy: false, activeSessions: 0 });
    }
  }

  // Parallel busy checks in chunks
  for (let i = 0; i < toCheck.length; i += concurrency) {
    const chunk = toCheck.slice(i, i + concurrency);
    const checks = await Promise.all(
      chunk.map((info) => checkBotBusy(pm, info.name as BotName)),
    );
    for (let j = 0; j < chunk.length; j++) {
      const info = chunk[j]!;
      const check = checks[j]!;
      candidates.push({
        info,
        busy: check.busy,
        activeSessions: check.activeSessions,
        lastActivity: check.lastActivity,
      });
    }
  }

  if (dryRun) {
    for (const c of candidates) {
      let status: BatchItemResult["status"] = "succeeded";
      let error: string | undefined;
      if (c.busy) {
        status = "skipped_busy";
      } else if (action === "restart") {
        // Verify config exists for restart dry-run
        const config = readBotConfig(join(mechaDir, c.info.name));
        if (!config) {
          status = "failed";
          error = "Config not found";
        }
      }
      const r: BatchItemResult = {
        name: c.info.name, status, error,
        activeSessions: c.activeSessions, lastActivity: c.lastActivity,
      };
      results.push(r);
      onProgress?.(r);
    }
    return buildResult(results);
  }

  // Execute with bounded parallelism
  for (let i = 0; i < candidates.length; i += concurrency) {
    const chunk = candidates.slice(i, i + concurrency);
    const chunkResults = await Promise.all(
      chunk.map((c) => executeSingle(pm, mechaDir, action, c, { force, idleOnly })),
    );
    for (const r of chunkResults) {
      results.push(r);
      onProgress?.(r);
    }
  }

  return buildResult(results);
}

async function executeSingle(
  pm: ProcessManager,
  mechaDir: string,
  action: "stop" | "restart",
  candidate: Candidate,
  opts: { force?: boolean; idleOnly?: boolean },
): Promise<BatchItemResult> {
  const { info, busy, activeSessions, lastActivity } = candidate;
  const name = info.name as BotName;

  if (busy) {
    if (opts.idleOnly) {
      // idleOnly: silently skip (counted as skipped)
      return { name, status: "skipped_busy", activeSessions, lastActivity };
    }
    if (!opts.force) {
      // Default: refuse operation (counted as failed)
      return { name, status: "failed", activeSessions, lastActivity, error: `${activeSessions} active session(s)` };
    }
  }

  try {
    if (action === "stop") {
      await pm.stop(name);
      return { name, status: "succeeded" };
    }

    // Restart: stop if running, then respawn
    const botDir = join(mechaDir, name);
    const config = readBotConfig(botDir);
    if (!config) {
      return { name, status: "failed", error: "Config not found" };
    }

    if (info.state === "running") {
      if (opts.force) {
        await pm.kill(name);
      } else {
        await pm.stop(name);
      }
    }

    await pm.spawn({
      name,
      workspacePath: config.workspace,
      port: config.port,
      /* v8 ignore start -- null coalescing fallback for optional config fields */
      auth: config.auth ?? undefined,
      /* v8 ignore stop */
      tags: config.tags,
      expose: config.expose,
      sandboxMode: config.sandboxMode,
      model: config.model,
      permissionMode: config.permissionMode,
    });

    return { name, status: "succeeded" };
  } catch (err) {
    return { name, status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

function buildResult(results: BatchItemResult[]): BatchResult {
  let succeeded = 0;
  let skipped = 0;
  let failed = 0;
  for (const r of results) {
    if (r.status === "succeeded") succeeded++;
    else if (r.status === "failed") failed++;
    else skipped++;
  }
  return { results, summary: { succeeded, skipped, failed } };
}
