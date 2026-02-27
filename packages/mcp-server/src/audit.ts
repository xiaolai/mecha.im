import { readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const AUDIT_FILE = "audit.jsonl";
const MAX_PARAMS_BYTES = 1024;

export interface AuditEntry {
  ts: string;
  client: string;
  tool: string;
  params: Record<string, unknown>;
  result: "ok" | "error";
  error?: string;
  durationMs: number;
}

export interface AuditLog {
  append(entry: AuditEntry): void;
  read(opts?: { limit?: number }): AuditEntry[];
  clear(): void;
}

function truncateParams(params: Record<string, unknown>): Record<string, unknown> {
  const serialized = JSON.stringify(params);
  if (serialized.length <= MAX_PARAMS_BYTES) return params;
  return { _truncated: serialized.slice(0, MAX_PARAMS_BYTES) + "...(truncated)" };
}

export function createAuditLog(mechaDir: string): AuditLog {
  const filePath = join(mechaDir, AUDIT_FILE);

  return {
    append(entry: AuditEntry): void {
      const safe = { ...entry, params: truncateParams(entry.params) };
      appendFileSync(filePath, JSON.stringify(safe) + "\n");
    },

    read(opts?: { limit?: number }): AuditEntry[] {
      let content: string;
      try {
        content = readFileSync(filePath, "utf-8");
      /* v8 ignore start -- file may not exist yet */
      } catch {
        return [];
      }
      /* v8 ignore stop */
      const lines = content.trim().split("\n").filter(Boolean);
      const entries = lines.map((line) => JSON.parse(line) as AuditEntry).reverse();
      if (opts?.limit && opts.limit > 0) return entries.slice(0, opts.limit);
      return entries;
    },

    clear(): void {
      writeFileSync(filePath, "");
    },
  };
}
