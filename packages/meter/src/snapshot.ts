import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { createLogger } from "@mecha/core";
import type { HotSnapshot } from "./types.js";

const log = createLogger("mecha:meter");

/** Path to snapshot.json */
export function snapshotPath(meterDir: string): string {
  return join(meterDir, "snapshot.json");
}

/** Read snapshot from disk. Returns null if missing or corrupt. */
export function readSnapshot(meterDir: string): HotSnapshot | null {
  try {
    const raw = readFileSync(snapshotPath(meterDir), "utf-8");
    const data = JSON.parse(raw) as HotSnapshot;
    if (!data.ts || !data.date || !data.global?.today || !data.global?.thisMonth) return null;
    return data;
  } catch {
    /* v8 ignore start -- missing file or corrupt JSON */
    log.warn("Failed to read snapshot.json, starting fresh");
    return null;
    /* v8 ignore stop */
  }
}

/** Write snapshot to disk atomically (unique temp file prevents concurrent collision) */
export function writeSnapshot(meterDir: string, snapshot: HotSnapshot): void {
  const path = snapshotPath(meterDir);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${Date.now()}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(snapshot, null, 2) + "\n");
  renameSync(tmp, path);
}
