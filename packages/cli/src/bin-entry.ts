#!/usr/bin/env bun
/**
 * Single compiled binary entrypoint for `mecha`.
 *
 * Two modes:
 *   CLI mode (default):      `mecha spawn alice /path`
 *   Runtime mode (internal): `mecha __runtime`  (spawned by CLI as child process)
 */
/* v8 ignore start -- compiled binary entrypoint, not testable in vitest */
import { createServer, parseRuntimeEnv } from "@mecha/runtime";
import { bootstrap } from "./bootstrap.js";

if (process.argv[2] === "__runtime") {
  startRuntime();
} else {
  bootstrap({
    runtimeBin: process.execPath,
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
    casaName: env.MECHA_CASA_NAME,
    port: env.MECHA_PORT,
    authToken: env.MECHA_AUTH_TOKEN,
    projectsDir: env.MECHA_PROJECTS_DIR,
    workspacePath: env.MECHA_WORKSPACE,
    mechaDir: env.MECHA_DIR,
    casaDir: env.MECHA_SANDBOX_ROOT,
  });

  app.listen({ port: env.MECHA_PORT, host: "127.0.0.1" }, (err) => {
    if (err) { console.error(err); process.exit(1); }
    console.log(`CASA ${env.MECHA_CASA_NAME} listening on port ${env.MECHA_PORT}`);
  });

  process.on("SIGTERM", () => { app.close(); });
}
/* v8 ignore stop */
