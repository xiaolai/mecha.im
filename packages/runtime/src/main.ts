import { createServer } from "./server.js";
import { parseRuntimeEnv } from "./env.js";

/* v8 ignore start -- entrypoint validated via env.test.ts */
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
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`CASA ${env.MECHA_CASA_NAME} listening on port ${env.MECHA_PORT}`);
});

process.on("SIGTERM", () => { app.close(); });
/* v8 ignore stop */
