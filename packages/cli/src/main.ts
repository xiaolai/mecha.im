#!/usr/bin/env node
/* v8 ignore start -- entrypoint wiring, tested via command integration tests */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { bootstrap } from "./bootstrap.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
let runtimeEntrypoint: string;
try {
  // Monorepo dev: resolve through pnpm workspace symlink
  const require = createRequire(import.meta.url);
  runtimeEntrypoint = require.resolve("@mecha/runtime/main.js");
} catch {
  // Published npm package: runtime.js is alongside main.js in dist/
  runtimeEntrypoint = join(__dirname, "runtime.js");
}

bootstrap({ runtimeEntrypoint });
/* v8 ignore stop */
