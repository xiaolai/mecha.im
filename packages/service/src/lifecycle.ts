import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ProcessManager } from "@mecha/process";
import { computeMechaId, DEFAULTS } from "@mecha/core";
import type { MechaId } from "@mecha/core";
import { MechaUpInput } from "@mecha/contracts";
import type {
  MechaUpInputType,
  MechaUpResultType,
  MechaRmInputType,
  MechaPruneResultType,
} from "@mecha/contracts";
import { validateProjectPath } from "./helpers.js";

// --- mechaUp ---
export async function mechaUp(
  pm: ProcessManager,
  input: MechaUpInputType,
): Promise<MechaUpResultType> {
  MechaUpInput.parse(input);
  await validateProjectPath(input.projectPath);

  const id = computeMechaId(input.projectPath);
  const authToken = randomBytes(32).toString("hex");

  const env: Record<string, string> = {};
  if (input.claudeToken) env.CLAUDE_CODE_OAUTH_TOKEN = input.claudeToken;
  if (input.anthropicApiKey) env.ANTHROPIC_API_KEY = input.anthropicApiKey;
  if (input.otp) env.MECHA_OTP = input.otp;
  if (input.permissionMode) env.MECHA_PERMISSION_MODE = input.permissionMode;
  if (input.env) {
    for (const entry of input.env) {
      const eqIdx = entry.indexOf("=");
      // Zod validates KEY=VALUE format, so eqIdx is always > 0 here
      env[entry.slice(0, eqIdx)] = entry.slice(eqIdx + 1);
    }
  }

  const mechaHome = join(homedir(), DEFAULTS.HOME_DIR);
  const claudeConfigDir = join(mechaHome, "claude-config", id);

  const info = await pm.spawn({
    mechaId: id,
    projectPath: input.projectPath,
    port: input.port ?? 0,
    claudeConfigDir,
    authToken,
    env,
    permissionMode: input.permissionMode,
  });

  return { id, name: id, port: info.port, authToken };
}

// --- mechaRm ---
export async function mechaRm(
  pm: ProcessManager,
  input: MechaRmInputType,
): Promise<void> {
  await pm.kill(input.id, input.force);
}

// --- mechaStart ---
export async function mechaStart(pm: ProcessManager, id: string): Promise<void> {
  // Re-spawn from saved state
  const existing = pm.get(id);
  if (!existing) throw new Error(`Mecha not found: ${id}`);

  const mechaHome = join(homedir(), DEFAULTS.HOME_DIR);
  const claudeConfigDir = join(mechaHome, "claude-config", id);

  await pm.spawn({
    mechaId: id as MechaId,
    projectPath: existing.projectPath,
    port: existing.port,
    claudeConfigDir,
    authToken: existing.authToken,
    env: existing.env,
  });
}

// --- mechaStop ---
export async function mechaStop(pm: ProcessManager, id: string): Promise<void> {
  await pm.stop(id);
}

// --- mechaRestart ---
export async function mechaRestart(pm: ProcessManager, id: string): Promise<void> {
  await pm.stop(id);
  await mechaStart(pm, id);
}

// --- mechaPrune ---
export async function mechaPrune(
  pm: ProcessManager,
): Promise<MechaPruneResultType> {
  const all = pm.list();
  const PRUNABLE_STATES = new Set(["stopped", "exited", "dead"]);
  const stopped = all.filter((p) => PRUNABLE_STATES.has(p.state));
  const removedProcesses: string[] = [];
  for (const p of stopped) {
    try {
      await pm.kill(p.id, true);
      removedProcesses.push(p.id);
    } catch { /* best effort */ }
  }
  return { removedProcesses };
}
