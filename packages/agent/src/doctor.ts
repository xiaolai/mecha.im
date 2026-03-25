import { existsSync } from "node:fs";
import { join } from "node:path";
import { readAuthProfiles } from "@mecha/core";
import { getMeterStatus, meterDir } from "@mecha/meter";

interface DoctorCheck {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
}

interface DoctorResult {
  checks: DoctorCheck[];
  healthy: boolean;
}

/** Runs system health checks. Keep in sync with packages/service/src/doctor.ts. */
export function mechaDoctor(mechaDir: string): DoctorResult {
  const checks: DoctorCheck[] = [];

  if (existsSync(mechaDir)) {
    checks.push({ name: "mecha-dir", status: "ok", message: `Found ${mechaDir}` });
  } else {
    checks.push({ name: "mecha-dir", status: "error", message: `Missing ${mechaDir} — run mecha init` });
  }

  for (const sub of ["auth", "tools", "logs"]) {
    const dir = join(mechaDir, sub);
    if (existsSync(dir)) {
      checks.push({ name: sub, status: "ok", message: `Found ${dir}` });
    } else {
      checks.push({ name: sub, status: "warn", message: `Missing ${dir}` });
    }
  }

  const nodeIdPath = join(mechaDir, "node-id");
  if (existsSync(nodeIdPath)) {
    checks.push({ name: "node-id", status: "ok", message: "Node ID present" });
  } else {
    checks.push({ name: "node-id", status: "warn", message: "No node ID — run mecha init" });
  }

  /* v8 ignore start -- auth store may be corrupt or missing */
  try {
    const store = readAuthProfiles(mechaDir);
    const profileNames = Object.keys(store.profiles);

    // Also detect env-var credentials (same logic as mechaAuthLs in @mecha/service)
    const envProfiles: Array<{ name: string; type: string }> = [];
    if (process.env.ANTHROPIC_API_KEY) envProfiles.push({ name: "$env:api-key", type: "api-key" });
    if (process.env.CLAUDE_CODE_OAUTH_TOKEN) envProfiles.push({ name: "$env:oauth", type: "oauth" });

    if (profileNames.length === 0 && envProfiles.length === 0) {
      checks.push({
        name: "auth-profiles",
        status: "error",
        message: "No auth profiles — run: mecha auth add <name> --oauth --token <token>",
      });
    } else {
      for (const name of profileNames) {
        const meta = store.profiles[name]!;
        const accountStr = meta.account ? ` (${meta.account})` : "";
        const defaultStr = store.default === name ? " [default]" : "";
        checks.push({
          name: `auth:${name}`,
          status: "ok",
          message: `${meta.type}${accountStr}${defaultStr}`,
        });
      }
      for (const ep of envProfiles) {
        checks.push({ name: `auth:${ep.name}`, status: "ok", message: `${ep.type} (env)` });
      }
    }
  } catch {
    checks.push({
      name: "auth-profiles",
      status: "error",
      message: "Auth store is corrupt — delete ~/.mecha/auth/ and re-add profiles",
    });
  }
  /* v8 ignore stop */

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

  /* v8 ignore start -- sandbox check only relevant on macOS */
  try {
    if (process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec")) {
      checks.push({ name: "sandbox", status: "ok", message: "macOS sandbox-exec (available)" });
    } else if (process.platform === "darwin") {
      checks.push({ name: "sandbox", status: "warn", message: "macOS sandbox-exec not found" });
    }
  } catch {
    checks.push({ name: "sandbox", status: "warn", message: "Could not check sandbox" });
  }
  /* v8 ignore stop */

  const healthy = checks.every((c) => c.status !== "error");
  return { checks, healthy };
}
