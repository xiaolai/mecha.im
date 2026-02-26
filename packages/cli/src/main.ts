#!/usr/bin/env node
/* v8 ignore start -- entrypoint wiring, tested via command integration tests */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrap } from "./bootstrap.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const runtimeEntrypoint = join(__dirname, "..", "..", "runtime", "dist", "main.js");

bootstrap({ runtimeEntrypoint });
/* v8 ignore stop */
