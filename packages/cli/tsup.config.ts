import { defineConfig } from "tsup";
import { resolve } from "node:path";

// Dependencies that should NOT be bundled — resolved from node_modules at runtime.
// This ensures the host's installed version is used, avoiding version drift.
const EXTERNAL = [
  "@anthropic-ai/claude-agent-sdk",
  "node-pty",  // native addon — must be resolved from node_modules at runtime
];

// CJS packages (bonjour-service) bundled into ESM use `require()` for Node builtins.
// esbuild's __require shim checks `typeof require !== "undefined"` — in ESM it's undefined,
// so it throws. Fix: assign a real require to globalThis before the shim runs.
const CJS_SHIM_BANNER = [
  `import { createRequire as __cjsShimCreateRequire } from "node:module";`,
  `if (typeof globalThis.require === "undefined") globalThis.require = __cjsShimCreateRequire(import.meta.url);`,
].join("\n");

export default defineConfig([
  {
    entry: ["src/index.ts", "src/main.ts"],
    format: ["esm"],
    dts: { compilerOptions: { composite: false } },
    clean: true,
    external: EXTERNAL,
    banner: { js: CJS_SHIM_BANNER },
  },
  {
    entry: { runtime: resolve(__dirname, "../runtime/src/main.ts") },
    format: ["esm"],
    dts: false,
    clean: false,
    external: EXTERNAL,
    banner: { js: CJS_SHIM_BANNER },
  },
]);
