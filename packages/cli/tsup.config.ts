import { defineConfig } from "tsup";
import { resolve } from "node:path";

// Dependencies that should NOT be bundled — resolved from node_modules at runtime.
// This ensures the host's installed version is used, avoiding version drift.
const EXTERNAL = [
  "@anthropic-ai/claude-agent-sdk",
  "node-pty",  // native addon — must be resolved from node_modules at runtime
];

export default defineConfig([
  {
    entry: ["src/index.ts", "src/main.ts"],
    format: ["esm"],
    dts: { compilerOptions: { composite: false } },
    clean: true,
    external: EXTERNAL,
  },
  {
    entry: { runtime: resolve(__dirname, "../runtime/src/main.ts") },
    format: ["esm"],
    dts: false,
    clean: false,
    external: EXTERNAL,
  },
]);
