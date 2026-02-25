#!/usr/bin/env node
/* v8 ignore start -- entrypoint wiring, tested via command integration tests */
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { createProgram } from "./program.js";
import { createFormatter } from "./formatter.js";
import { createProcessManager } from "@mecha/process";
import { createAclEngine, MechaError } from "@mecha/core";
import { createSandbox } from "@mecha/sandbox";
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
const sandbox = createSandbox();
const processManager = createProcessManager({ mechaDir, runtimeEntrypoint, sandbox });

const acl = createAclEngine({ mechaDir });
const shutdownHooks: Array<() => Promise<void>> = [];
const deps: CommandDeps = { formatter, processManager, mechaDir, acl, sandbox, registerShutdownHook: (fn) => { shutdownHooks.push(fn); } };
const program = createProgram(deps);

// Graceful shutdown: only stop CASAs that this CLI process spawned (in-memory live map).
// Scoped to prevent `mecha ls; Ctrl-C` from killing all running CASAs.
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  // Run registered shutdown hooks first (e.g., agent server close)
  Promise.allSettled(shutdownHooks.map((fn) => fn())).then(() => {
    // Only stop CASAs with a live child process handle (spawned by this CLI invocation)
    const live = processManager.list().filter((p) => p.state === "running" && p.token);
    if (live.length > 0) {
      Promise.allSettled(live.map((p) => processManager.stop(p.name)))
        .then((results) => {
          const failed = results.some((r) => r.status === "rejected");
          if (failed) {
            for (const r of results) {
              if (r.status === "rejected") {
                console.error("Shutdown error:", r.reason instanceof Error ? r.reason.message : String(r.reason));
              }
            }
          }
          process.exit(failed ? 1 : 0);
        });
    } else {
      process.exit(0);
    }
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

program.parseAsync(process.argv).catch((err: unknown) => {
  formatter.error(err instanceof Error ? err.message : String(err));
  process.exitCode = err instanceof MechaError ? err.exitCode : 1;
});
/* v8 ignore stop */
