import { existsSync } from "node:fs";
import { join } from "node:path";
import { readAuthProfiles } from "@mecha/core";
import { getMeterStatus, meterDir } from "@mecha/meter";

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
  for (const sub of ["auth", "tools", "logs"]) {
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

  // Auth profile checks — wrapped to prevent crash on corrupt auth files
  try {
    const store = readAuthProfiles(mechaDir);
    const profileNames = Object.keys(store.profiles);
    if (profileNames.length === 0) {
      checks.push({
        name: "auth-profiles",
        status: "error",
        message: "No auth profiles — run: mecha auth add <name> --oauth --token <token>",
      });
    } else {
      for (const name of profileNames) {
        const meta = store.profiles[name]!;
        /* v8 ignore start -- display formatting branches for account/default label */
        const accountStr = meta.account ? ` (${meta.account})` : "";
        const defaultStr = store.default === name ? " [default]" : "";
        /* v8 ignore stop */
        checks.push({
          name: `auth:${name}`,
          status: "ok",
          message: `${meta.type}${accountStr}${defaultStr}`,
        });
      }
    }
  } catch {
    /* v8 ignore start -- defensive: corrupt auth store */
    checks.push({
      name: "auth-profiles",
      status: "error",
      message: "Auth store is corrupt — delete ~/.mecha/auth/ and re-add profiles",
    });
    /* v8 ignore stop */
  }

  // Meter proxy status
  const meterStatus = getMeterStatus(meterDir(mechaDir));
  if (meterStatus.running) {
    checks.push({
      name: "meter",
      status: "ok",
      message: `Proxy running on port ${meterStatus.port} (pid ${meterStatus.pid})`,
    });
  } else {
    checks.push({
      name: "meter",
      status: "warn",
      message: "Meter proxy not running — run: mecha meter start",
    });
  }

  const healthy = checks.every((c) => c.status !== "error");
  return { checks, healthy };
}
