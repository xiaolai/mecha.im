#!/usr/bin/env bun
/**
 * Single compiled binary entrypoint for `mecha`.
 *
 * Two modes:
 *   CLI mode (default):      `mecha spawn alice /path`
 *   Runtime mode (internal): `mecha __runtime`  (spawned by CLI as child process)
 */
/* v8 ignore start -- compiled binary entrypoint, not testable in vitest */
import { realpathSync, existsSync } from "node:fs";
import { createServer, parseRuntimeEnv } from "@mecha/runtime";
import { bootstrap } from "./bootstrap.js";

/** Resolve the real on-disk path of this binary.
 *  Bun compiled binaries return VFS paths for process.execPath and "bun" for argv[0].
 *  On Linux, /proc/self/exe is a reliable symlink to the actual executable. */
function resolveSelfBin(): string {
  if (existsSync("/proc/self/exe")) {
    try { return realpathSync("/proc/self/exe"); } catch { /* fall through */ }
  }
  // macOS / fallback: Bun.argv[0] or process.execPath
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bunGlobal = globalThis as any;
  const candidate = (bunGlobal.Bun?.argv?.[0] as string | undefined) || process.execPath;
  if (candidate && candidate !== "bun" && !candidate.startsWith("/$bunfs/")) return candidate;
  return process.execPath;
}

if (process.argv[2] === "__runtime") {
  startRuntime();
} else {
  const selfBin = resolveSelfBin();
  bootstrap({
    runtimeBin: selfBin,
    runtimeArgs: ["__runtime"],
  });
}

function startRuntime(): void {
  let env: ReturnType<typeof parseRuntimeEnv>;
  try {
    env = parseRuntimeEnv(process.env as Record<string, string | undefined>);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const { app } = createServer({
    botName: env.MECHA_BOT_NAME,
    port: env.MECHA_PORT,
    authToken: env.MECHA_AUTH_TOKEN,
    projectsDir: env.MECHA_PROJECTS_DIR,
    workspacePath: env.MECHA_WORKSPACE,
    mechaDir: env.MECHA_DIR,
    botDir: env.MECHA_SANDBOX_ROOT,
  });

  app.listen({ port: env.MECHA_PORT, host: "127.0.0.1" }, (err) => {
    if (err) { console.error(err); process.exit(1); }
    console.log(`bot ${env.MECHA_BOT_NAME} listening on port ${env.MECHA_PORT}`);
  });

  process.on("SIGTERM", () => { app.close(); });
}
/* v8 ignore stop */
