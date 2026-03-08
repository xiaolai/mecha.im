import { defineConfig } from "vitest/config";

const projects = [
  { test: { name: "core", include: ["packages/core/__tests__/**/*.test.ts"] } },
  {
    test: { name: "agent", include: ["packages/agent/__tests__/**/*.test.ts"] },
  },
  { test: { name: "cli", include: ["packages/cli/__tests__/**/*.test.ts"] } },
  {
    test: {
      name: "process",
      include: ["packages/process/__tests__/**/*.test.ts"],
    },
  },
  {
    test: {
      name: "sandbox",
      include: ["packages/sandbox/__tests__/**/*.test.ts"],
    },
  },
  {
    test: {
      name: "runtime",
      include: ["packages/runtime/__tests__/**/*.test.ts"],
    },
  },
  {
    test: {
      name: "service",
      include: ["packages/service/__tests__/**/*.test.ts"],
    },
  },
  {
    test: { name: "meter", include: ["packages/meter/__tests__/**/*.test.ts"] },
  },
  {
    test: {
      name: "connect",
      include: ["packages/connect/__tests__/**/*.test.ts"],
    },
  },
  {
    test: {
      name: "server",
      include: ["packages/server/__tests__/**/*.test.ts"],
    },
  },
  {
    test: {
      name: "mcp-server",
      include: ["packages/mcp-server/__tests__/**/*.test.ts"],
    },
  },
  {
    test: {
      name: "dashboard",
      include: ["packages/dashboard/__tests__/**/*.test.ts"],
      exclude: ["packages/dashboard/__tests__/integration.test.ts"],
    },
  },
  {
    test: {
      name: "integration",
      include: ["packages/integration/__tests__/**/*.test.ts"],
      testTimeout: 30_000,
      sequence: { concurrent: false },
    },
  },
];

export { projects };

export default defineConfig({
  test: {
    projects,
    // JUnit reporter writes to reports/junit.xml — acceptable for local-first usage
    // where the working tree is always writable. No need to conditionalize.
    reporters: ["default", "junit"],
    outputFile: {
      junit: "reports/junit.xml",
    },
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
        "packages/spa/src/**",
      ],
      thresholds: {
        // v8 JSON summary reporter counts branches (and occasionally statements/
        // functions/lines) inside /* v8 ignore start/stop */ blocks as uncovered,
        // even though the HTML report correctly excludes them. Thresholds below
        // accommodate this known vitest/v8 reporter bug.
        lines: 99.7,
        functions: 99.5,
        branches: 98.5,
        statements: 99.7,
      },
      reporter: ["text-summary", "json-summary", "html"],
      reportsDirectory: "reports/coverage",
    },
  },
});
