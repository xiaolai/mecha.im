import { existsSync } from "node:fs";
import { join } from "node:path";

export interface DoctorCheck {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
}

export interface DoctorResult {
  checks: DoctorCheck[];
  healthy: boolean;
}

/**
 * Runs system health checks.
 */
export function mechaDoctor(mechaDir: string): DoctorResult {
  const checks: DoctorCheck[] = [];

  // Check mecha directory exists
  if (existsSync(mechaDir)) {
    checks.push({ name: "mecha-dir", status: "ok", message: `Found ${mechaDir}` });
  } else {
    checks.push({ name: "mecha-dir", status: "error", message: `Missing ${mechaDir} — run mecha init` });
  }

  // Check subdirectories
  for (const sub of ["casas", "auth", "tools", "logs"]) {
    const dir = join(mechaDir, sub);
    if (existsSync(dir)) {
      checks.push({ name: sub, status: "ok", message: `Found ${dir}` });
    } else {
      checks.push({ name: sub, status: "warn", message: `Missing ${dir}` });
    }
  }

  // Check node-id
  const nodeIdPath = join(mechaDir, "node-id");
  if (existsSync(nodeIdPath)) {
    checks.push({ name: "node-id", status: "ok", message: "Node ID present" });
  } else {
    checks.push({ name: "node-id", status: "warn", message: "No node ID — run mecha init" });
  }

  const healthy = checks.every((c) => c.status !== "error");
  return { checks, healthy };
}
