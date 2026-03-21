import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type BotName, ProcessSpawnError, readBotConfig } from "@mecha/core";
import { profileFromConfig } from "@mecha/sandbox";
import type { PersistedSandboxProfile, SandboxPlatform } from "@mecha/sandbox";
import type { ProcessEventEmitter } from "./events.js";
import type { SpawnContext } from "./types.js";

/** Apply sandbox wrapping to spawn binary/args if sandbox is available and enabled. */
/* v8 ignore start -- sandbox integration tested via CLI E2E */
export async function applySandboxWrapping(opts: {
  ctx: SpawnContext; sandboxMode: string; botDir: string; mechaDir: string;
  name: BotName; spawnBin: string; spawnArgs: string[]; emitter: ProcessEventEmitter;
}): Promise<{ bin: string; args: string[]; platform: SandboxPlatform | undefined }> {
  const { ctx, sandboxMode, botDir, mechaDir, name, emitter } = opts;
  let bin = opts.spawnBin;
  let args = opts.spawnArgs;
  let platform: SandboxPlatform | undefined;

  if (sandboxMode !== "off" && ctx.sandbox) {
    const available = ctx.sandbox.isAvailable();
    if (sandboxMode === "require" && !available) {
      throw new ProcessSpawnError(`Sandbox required but ${ctx.sandbox.describe()}`);
    }
    if (available) {
      const config = readBotConfig(botDir);
      if (!config && sandboxMode === "require") {
        throw new ProcessSpawnError("Sandbox required but config.json could not be read for profile generation");
      }
      if (config) {
        const profile = profileFromConfig({
          config, botDir, mechaDir, runtimeEntrypoint: ctx.opts.runtimeEntrypoint,
        });
        const wrapped = await ctx.sandbox.wrap(profile, bin, args, botDir);
        bin = wrapped.bin;
        args = wrapped.args;
        platform = ctx.sandbox.platform;
        const persisted: PersistedSandboxProfile = {
          platform: ctx.sandbox.platform, profile, createdAt: new Date().toISOString(),
        };
        const sandboxProfilePath = join(botDir, "sandbox-profile.json");
        writeFileSync(sandboxProfilePath, JSON.stringify(persisted, null, 2) + "\n", { mode: 0o600 });
        chmodSync(sandboxProfilePath, 0o600);
      }
    } else if (sandboxMode === "auto") {
      emitter.emit({ type: "warning", name, message: "Kernel sandbox not available, running without sandbox" });
    }
  }

  return { bin, args, platform };
}
/* v8 ignore stop */
