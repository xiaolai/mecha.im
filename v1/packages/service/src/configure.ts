import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ProcessManager } from "@mecha/process";
import { DEFAULTS } from "@mecha/core";
import {
  ConfigureNoFieldsError,
} from "@mecha/contracts";
import type {
  MechaConfigureInputType,
} from "@mecha/contracts";
import {
  validatePermissionMode,
} from "./helpers.js";

// --- mechaConfigure ---
export async function mechaConfigure(
  pm: ProcessManager,
  input: MechaConfigureInputType,
): Promise<void> {
  const hasUpdate = input.claudeToken !== undefined ||
    input.anthropicApiKey !== undefined ||
    input.otp !== undefined ||
    input.permissionMode !== undefined;
  if (!hasUpdate) throw new ConfigureNoFieldsError();

  validatePermissionMode(input.permissionMode);

  const info = pm.get(input.id);
  if (!info) throw new Error(`Mecha not found: ${input.id}`);

  // Build updated env
  const envMap = new Map(Object.entries(info.env));
  if (input.claudeToken !== undefined) {
    if (input.claudeToken) envMap.set("CLAUDE_CODE_OAUTH_TOKEN", input.claudeToken);
    else envMap.delete("CLAUDE_CODE_OAUTH_TOKEN");
  }
  if (input.anthropicApiKey !== undefined) {
    if (input.anthropicApiKey) envMap.set("ANTHROPIC_API_KEY", input.anthropicApiKey);
    else envMap.delete("ANTHROPIC_API_KEY");
  }
  if (input.otp !== undefined) {
    if (input.otp) envMap.set("MECHA_OTP", input.otp);
    else envMap.delete("MECHA_OTP");
  }
  if (input.permissionMode !== undefined) {
    envMap.set("MECHA_PERMISSION_MODE", input.permissionMode);
  }

  // Stop → re-spawn with updated env (rollback on failure)
  await pm.stop(input.id);

  const mechaHome = join(homedir(), DEFAULTS.HOME_DIR);
  const claudeConfigDir = join(mechaHome, "claude-config", input.id);

  try {
    await pm.spawn({
      mechaId: info.id,
      projectPath: info.projectPath,
      port: info.port,
      claudeConfigDir,
      authToken: info.authToken,
      env: Object.fromEntries(envMap),
      permissionMode: envMap.get("MECHA_PERMISSION_MODE"),
    });
  /* v8 ignore start -- spawn failure rollback requires breaking runtime entry */
  } catch (spawnErr) {
    // Rollback: try to restart with original config
    try {
      await pm.spawn({
        mechaId: info.id,
        projectPath: info.projectPath,
        port: info.port,
        claudeConfigDir,
        authToken: info.authToken,
        env: info.env,
        permissionMode: info.env["MECHA_PERMISSION_MODE"],
      });
    } catch {
      // Rollback failed — mecha is down
    }
    throw spawnErr;
  }
  /* v8 ignore stop */
}

// --- mechaInit ---
export async function mechaInit(): Promise<void> {
  const mechaHome = join(homedir(), DEFAULTS.HOME_DIR);
  await mkdir(mechaHome, { recursive: true });
  await mkdir(join(mechaHome, DEFAULTS.STATE_DIR), { recursive: true });
  await mkdir(join(mechaHome, DEFAULTS.LOG_DIR), { recursive: true });
}
