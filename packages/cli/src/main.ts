#!/usr/bin/env node
import { createProgram } from "./program.js";
import { createFormatter } from "./formatter.js";
import type { CommandDeps } from "./types.js";

const formatter = createFormatter({
  json: process.argv.includes("--json"),
  quiet: process.argv.includes("--quiet"),
  verbose: process.argv.includes("--verbose"),
});

const deps: CommandDeps = { formatter };
const program = createProgram(deps);

program.parseAsync(process.argv).catch((err: unknown) => {
  formatter.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
