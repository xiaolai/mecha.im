#!/usr/bin/env node
/* v8 ignore start -- entrypoint wiring, tested via command integration tests */
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { createProgram } from "./program.js";
import { createFormatter } from "./formatter.js";
import { createProcessManager } from "@mecha/process";
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

const deps: CommandDeps = { formatter, processManager, mechaDir };
const program = createProgram(deps);

program.parseAsync(process.argv).catch((err: unknown) => {
  formatter.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
/* v8 ignore stop */
