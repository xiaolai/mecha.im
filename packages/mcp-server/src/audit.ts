import { readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const AUDIT_FILE = "audit.jsonl";
const MAX_PARAMS_BYTES = 1024;
const FILE_MODE = 0o600;

/** A single audit log entry recording an MCP tool invocation. */
export interface AuditEntry {
  ts: string;
  client: string;
  tool: string;
  params: Record<string, unknown>;
  result: "ok" | "error" | "rate-limited";
  error?: string;
  durationMs: number;
}

/** Append-only JSONL audit log for MCP tool calls. */
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

/** Create a filesystem-backed audit log stored as `audit.jsonl` in the mecha directory. */
export function createAuditLog(mechaDir: string): AuditLog {
  const filePath = join(mechaDir, AUDIT_FILE);

  return {
    append(entry: AuditEntry): void {
      const safe = { ...entry, params: truncateParams(entry.params) };
      try {
        appendFileSync(filePath, JSON.stringify(safe) + "\n", { mode: FILE_MODE });
      /* v8 ignore start -- disk full / permission errors are runtime-only */
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[mecha] audit write failed: ${msg}\n`);
      }
      /* v8 ignore stop */
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
      const entries: AuditEntry[] = [];
      for (const line of lines) {
        try {
          entries.push(JSON.parse(line) as AuditEntry);
        /* v8 ignore start -- corrupt lines are runtime-only */
        } catch {
          // Skip corrupt JSONL lines (e.g. partial writes from a crash)
        }
        /* v8 ignore stop */
      }
      entries.reverse();
      if (opts?.limit && opts.limit > 0) return entries.slice(0, opts.limit);
      return entries;
    },

    clear(): void {
      writeFileSync(filePath, "", { mode: FILE_MODE });
    },
  };
}
