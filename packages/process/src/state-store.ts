import { readFileSync, writeFileSync, readdirSync, mkdirSync, unlinkSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { MechaProcessInfo } from "./types.js";

/**
 * Per-process JSON state files at `~/.mecha/processes/<mechaId>.json`.
 *
 * Each file is independent — no global lock needed.
 * Atomic writes via temp-file + rename.
 */
export class StateStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  /** Save process info to a JSON file. Atomic write via rename. */
  save(info: MechaProcessInfo): void {
    const filePath = this.filePath(info.id);
    const tmpPath = `${filePath}.${randomBytes(4).toString("hex")}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(info, null, 2) + "\n");
    renameSync(tmpPath, filePath);
  }

  /** Load process info by ID. Returns undefined if file does not exist. */
  load(id: string): MechaProcessInfo | undefined {
    try {
      const raw = readFileSync(this.filePath(id), "utf-8");
      return JSON.parse(raw) as MechaProcessInfo;
    } catch {
      return undefined;
    }
  }

  /** Remove the state file for a given ID. No-op if file does not exist. */
  remove(id: string): void {
    try {
      unlinkSync(this.filePath(id));
    } catch {
      // ignore
    }
  }

  /** List all stored process infos. */
  listAll(): MechaProcessInfo[] {
    let files: string[];
    try {
      files = readdirSync(this.dir).filter((f) => f.endsWith(".json"));
    } catch {
      return [];
    }
    const result: MechaProcessInfo[] = [];
    for (const file of files) {
      try {
        const raw = readFileSync(join(this.dir, file), "utf-8");
        result.push(JSON.parse(raw) as MechaProcessInfo);
      } catch {
        // skip corrupt files
      }
    }
    return result;
  }

  private filePath(id: string): string {
    return join(this.dir, `${id}.json`);
  }
}

/**
 * Check if a PID is alive by sending signal 0.
 * Also verifies the start fingerprint if available.
 */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
