/**
 * mecha doctor — diagnose mecha and bot health
 *
 * `mecha doctor`        → check mecha-level health (Docker, image, settings)
 * `mecha doctor <bot>`  → check bot container health (mounts, SDK config, claude pickup, auth, runtime)
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getBot, getMechaDir } from "./store.js";
import { IMAGE_NAME } from "./constants.js";
import { docker } from "./docker.utils.js";
import { isProcessAlive, readPidFile } from "./native.utils.js";
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
  const dockerResult = await checkDocker();
  const checks: CheckResult[] = [
    existsSync(dir) ? { ok: true, label: `Mecha dir exists (${dir})` } : { ok: false, label: "Mecha dir", detail: "not found — run: mecha init" },
    dockerResult.ok ? dockerResult : { ok: true, label: "Docker daemon (optional for --native)", detail: dockerResult.detail },
    ...(dockerResult.ok ? [await checkImage()] : []),
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
  if (entry) info("Registry", `path=${entry.path}, config=${entry.config}, runtime=${entry.runtime ?? "docker"}`);
  else warn("Registry", `bot "${name}" not in registry`);

  function tally(r: { passed: number; failed: number }) {
    totalPassed += r.passed; totalFailed += r.failed;
  }

  // Native runtime — simplified checks (no Docker container)
  if (entry?.runtime === "native") {
    console.log("\n[Process]");
    const pid = entry.pid ?? (entry.path ? readPidFile(entry.path) : null);
    const checks: CheckResult[] = [];
    if (pid) {
      checks.push(isProcessAlive(pid)
        ? { ok: true, label: `Process alive (PID ${pid})` }
        : { ok: false, label: `Process alive (PID ${pid})`, detail: "process not running" });
    } else {
      checks.push({ ok: false, label: "PID file", detail: "no PID found" });
    }
    tally(report(checks));

    console.log("\n[Health]");
    const port = entry.port;
    if (port && port >= 1 && port <= 65535) {
      try {
        const resp = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) });
        tally(report([resp.ok
          ? { ok: true, label: `Health endpoint :${port}/health` }
          : { ok: false, label: `Health endpoint :${port}/health`, detail: `HTTP ${resp.status}` }]));
      } catch (err) {
        tally(report([{ ok: false, label: `Health endpoint :${port}/health`, detail: err instanceof Error ? err.message : String(err) }]));
      }
    } else {
      tally(report([{ ok: false, label: "Health endpoint", detail: "no port in registry" }]));
    }

    console.log("\n[State Dir]");
    const stateChecks: CheckResult[] = [];
    if (entry.path) {
      stateChecks.push(existsSync(entry.path)
        ? { ok: true, label: `State dir exists (${entry.path})` }
        : { ok: false, label: "State dir", detail: "not found" });
      stateChecks.push(existsSync(join(entry.path, "bot.yaml"))
        ? { ok: true, label: "bot.yaml exists" }
        : { ok: false, label: "bot.yaml", detail: "not found" });
    }
    tally(report(stateChecks));

    console.log(`\n--- ${totalPassed} passed, ${totalFailed} failed ---`);
    return totalFailed > 0 ? 1 : 0;
  }

  // Docker runtime — existing checks
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
