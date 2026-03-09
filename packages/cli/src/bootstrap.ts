import { join } from "node:path";
import { homedir } from "node:os";
import { createProgram } from "./program.js";
import { createFormatter } from "./formatter.js";
import { createProcessManager, type CreateProcessManagerOpts } from "@mecha/process";
import { createAclEngine, CliAlreadyRunningError, MechaError } from "@mecha/core";
import { createSandbox } from "@mecha/sandbox";
import { acquireCliLock, needsLock, readCliLock, releaseCliLock } from "./cli-lock.js";
import type { CommandDeps } from "./types.js";

/** Options for bootstrapping the CLI process. */
export interface BootstrapOpts {
  /** Override for runtimeEntrypoint (node + JS entrypoint mode) */
  runtimeEntrypoint?: string;
  /** Override for runtimeBin (standalone binary mode) */
  runtimeBin?: string;
  /** Extra args for runtimeBin (e.g. ["__runtime"]) */
  runtimeArgs?: string[];
}

/* v8 ignore start -- entrypoint wiring, tested via command integration tests */
/** Bootstrap the CLI: create deps, wire shutdown, parse argv. */
export function bootstrap(opts: BootstrapOpts): void {
  const formatter = createFormatter({
    json: process.argv.includes("--json"),
    quiet: process.argv.includes("--quiet"),
    verbose: process.argv.includes("--verbose"),
  });

  const mechaDir = process.env.MECHA_DIR ?? join(homedir(), ".mecha");

  // Singleton guard — only mutating commands need the lock.
  // Read-only commands (ls, status, logs, cost, etc.) always run freely.
  const locked = needsLock(process.argv);
  if (locked && !acquireCliLock(mechaDir)) {
    const existing = readCliLock(mechaDir);
    const pid = existing?.pid ?? 0;
    const err = new CliAlreadyRunningError(pid);
    formatter.error(err.message);
    process.exitCode = err.exitCode;
    return;
  }

  const sandbox = createSandbox();

  const pmOpts: CreateProcessManagerOpts = { mechaDir, sandbox };
  if (opts.runtimeBin) {
    pmOpts.runtimeBin = opts.runtimeBin;
    pmOpts.runtimeArgs = opts.runtimeArgs;
  } else if (opts.runtimeEntrypoint) {
    pmOpts.runtimeEntrypoint = opts.runtimeEntrypoint;
  }
  const processManager = createProcessManager(pmOpts);

  const acl = createAclEngine({ mechaDir });
  const shutdownHooks: Array<() => Promise<void>> = [];
  const deps: CommandDeps = {
    formatter, processManager, mechaDir, acl, sandbox,
    registerShutdownHook: (fn) => { shutdownHooks.push(fn); },
  };
  const program = createProgram(deps);

  let shuttingDown = false;
  function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    Promise.allSettled(shutdownHooks.map((fn) => Promise.resolve().then(fn))).then((hookResults) => {
      for (const r of hookResults) {
        if (r.status === "rejected") {
          console.error("Shutdown hook error:", r.reason instanceof Error ? r.reason.message : String(r.reason));
        }
      }
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
  if (locked) {
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    process.on("exit", () => releaseCliLock(mechaDir));
  }

  process.on("unhandledRejection", (reason) => {
    console.error("[mecha:cli] Unhandled rejection:", reason instanceof Error ? reason.message : String(reason));
    process.exitCode = 1;
  });
  process.on("uncaughtException", (err) => {
    console.error("[mecha:cli] Uncaught exception:", err.message);
    process.exitCode = 1;
  });

  program.parseAsync(process.argv).catch((err: unknown) => {
    formatter.error(err instanceof Error ? err.message : String(err));
    process.exitCode = err instanceof MechaError ? err.exitCode : 1;
  });
}
/* v8 ignore stop */
