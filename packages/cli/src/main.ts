#!/usr/bin/env node
/* v8 ignore start -- entrypoint wiring, tested via command integration tests */
import { join } from "node:path";
import { homedir } from "node:os";
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
const processManager = createProcessManager({ mechaDir });

const deps: CommandDeps = { formatter, processManager, mechaDir };
const program = createProgram(deps);

program.parseAsync(process.argv).catch((err: unknown) => {
  formatter.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
/* v8 ignore stop */
