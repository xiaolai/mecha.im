/**
 * mecha doctor — diagnose mecha and bot health
 *
 * `mecha doctor`        → check mecha-level health (Docker, image, settings)
 * `mecha doctor <bot>`  → check bot container health (mounts, SDK config, claude pickup, auth, runtime)
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getBot, getMechaDir } from "./store.js";
import { IMAGE_NAME } from "./docker.constants.js";
import { docker } from "./docker.utils.js";
import {
  type CheckResult, report, info, warn,
  checkContainer, checkHealth, checkMounts, checkEnv, checkRuntime, checkClaudePickup,
} from "./doctor.utils.js";

// ─── Mecha-level checks ───

async function checkDocker(): Promise<CheckResult> {
  try {
    await docker.ping();
    return { ok: true, label: "Docker daemon reachable" };
  } catch (err) {
    return { ok: false, label: "Docker daemon reachable", detail: err instanceof Error ? err.message : String(err) };
  }
}

async function checkImage(): Promise<CheckResult> {
  try {
    const img = await docker.getImage(IMAGE_NAME).inspect();
    const sizeMb = Math.round((img.Size ?? 0) / 1024 / 1024);
    return { ok: true, label: `Image "${IMAGE_NAME}" exists (${sizeMb}MB)` };
  } catch {
    return { ok: false, label: `Image "${IMAGE_NAME}" exists`, detail: "not found — run: mecha init" };
  }
}

export async function doctorMecha(): Promise<number> {
  console.log("--- Mecha Doctor ---\n");

  const dir = getMechaDir();
  const credPath = join(dir, "credentials.yaml");
  const checks: CheckResult[] = [
    existsSync(dir) ? { ok: true, label: `Mecha dir exists (${dir})` } : { ok: false, label: "Mecha dir", detail: "not found — run: mecha init" },
    await checkDocker(),
    await checkImage(),
    existsSync(credPath) ? { ok: true, label: "Credentials file exists" } : { ok: false, label: "Credentials", detail: "no credentials.yaml — run: mecha auth add" },
  ];

  const { passed, failed } = report(checks);
  console.log(`\n--- ${passed} passed, ${failed} failed ---`);
  return failed > 0 ? 1 : 0;
}

// ─── Bot-level orchestrator ───

export async function doctorBot(name: string): Promise<number> {
  console.log(`--- Bot Doctor: ${name} ---\n`);
  let totalPassed = 0, totalFailed = 0;

  const entry = getBot(name);
  if (entry) info("Registry", `path=${entry.path}, config=${entry.config}`);
  else warn("Registry", `bot "${name}" not in registry`);

  function tally(r: { passed: number; failed: number }) {
    totalPassed += r.passed; totalFailed += r.failed;
  }

  console.log("\n[Container]");
  const { checks: containerChecks, container, cInfo } = await checkContainer(name);
  tally(report(containerChecks));
  if (!container || !cInfo) {
    console.log("\n--- Cannot continue without a running container ---");
    return 1;
  }

  console.log("\n[Health]");
  tally(report(await checkHealth(cInfo)));

  console.log("\n[Mounts]");
  tally(report(checkMounts(cInfo)));

  console.log("\n[Environment]");
  tally(report(checkEnv(cInfo)));

  console.log("\n[Runtime]");
  tally(report(await checkRuntime(container)));

  console.log("\n[Claude Config Pickup]");
  tally(report(await checkClaudePickup(container)));

  console.log(`\n--- ${totalPassed} passed, ${totalFailed} failed ---`);
  return totalFailed > 0 ? 1 : 0;
}
