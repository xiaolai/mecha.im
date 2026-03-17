/**
 * Structured JSONL audit logger for daemon operations.
 * Appends one JSON object per line. Rotates at 10MB, keeps 5 files.
 */

import { appendFileSync, statSync, renameSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getMechaDir } from "./store.js";

const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES = 5;

function auditPath(): string {
  return join(getMechaDir(), "logs", "daemon-audit.jsonl");
}

export interface AuditEvent {
  actor: string;     // daemon:reconciler, fleet:orchestrator, cli:spawn, etc.
  action: string;    // auto-restart, spawn, stop, etc.
  target?: string;   // bot name or resource
  detail?: Record<string, unknown>;
  result: "success" | "failure" | "skipped";
}

export function auditLog(event: AuditEvent): void {
  const path = auditPath();
  mkdirSync(join(getMechaDir(), "logs"), { recursive: true });
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n";
  try {
    appendFileSync(path, line);
    // Rotate if needed
    const size = statSync(path).size;
    if (size > MAX_SIZE) {
      for (let i = MAX_FILES - 1; i >= 1; i--) {
        try { renameSync(`${path}.${i}`, `${path}.${i + 1}`); } catch { /* ok */ }
      }
      renameSync(path, `${path}.1`);
    }
  } catch { /* best-effort logging */ }
}
