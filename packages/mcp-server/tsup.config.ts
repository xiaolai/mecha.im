import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/main.ts"],
  format: ["esm"],
  dts: { compilerOptions: { composite: false } },
  clean: true,
});
