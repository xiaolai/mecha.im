#!/usr/bin/env node
/* v8 ignore start -- entrypoint wiring, tested via command integration tests */
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { createProgram } from "./program.js";
import { createFormatter } from "./formatter.js";
import { createProcessManager } from "@mecha/process";
import { createAclEngine, MechaError } from "@mecha/core";
import type { CommandDeps } from "./types.js";

const formatter = createFormatter({
  json: process.argv.includes("--json"),
  quiet: process.argv.includes("--quiet"),
  verbose: process.argv.includes("--verbose"),
});

const mechaDir = process.env.MECHA_DIR ?? join(homedir(), ".mecha");
// Resolve the @mecha/runtime entrypoint relative to this package
const __dirname = dirname(fileURLToPath(import.meta.url));
const runtimeEntrypoint = join(__dirname, "..", "..", "runtime", "dist", "main.js");
const processManager = createProcessManager({ mechaDir, runtimeEntrypoint });

const acl = createAclEngine({ mechaDir });
const deps: CommandDeps = { formatter, processManager, mechaDir, acl };
const program = createProgram(deps);

// Graceful shutdown: stop all running CASAs on SIGINT/SIGTERM
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  const running = processManager.list().filter((p) => p.state === "running");
  if (running.length > 0) {
    Promise.allSettled(running.map((p) => processManager.stop(p.name)))
      .then(() => { process.exit(0); })
      .catch(() => { process.exit(1); });
  }
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

program.parseAsync(process.argv).catch((err: unknown) => {
  formatter.error(err instanceof Error ? err.message : String(err));
  process.exitCode = err instanceof MechaError ? err.exitCode : 1;
});
/* v8 ignore stop */
