import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**"],
      exclude: [
        "**/__tests__/**",
        "**/dist/**",
        "**/node_modules/**",
        "**/index.ts",
        "**/types.ts",
        "**/bin.ts",
        "**/main.ts",
        "**/transport.ts",
        "**/http-transport.ts",
        "packages/dashboard/src/app/**",
        "packages/dashboard/src/components/**",
        "packages/dashboard/src/server-entry.ts",
        "packages/dashboard/src/lib/use-fetch.ts",
        "packages/dashboard/src/lib/use-casa-action.ts",
        "packages/dashboard/src/lib/pm-singleton.ts",
        "packages/dashboard/src/lib/params.ts",
      ],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
      reporter: ["text-summary", "json-summary"],
    },
  },
});
