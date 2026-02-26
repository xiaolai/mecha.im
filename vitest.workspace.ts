import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    test: {
      name: "core",
      include: ["packages/core/__tests__/**/*.test.ts"],
    },
  },
  {
    test: {
      name: "agent",
      include: ["packages/agent/__tests__/**/*.test.ts"],
    },
  },
  {
    test: {
      name: "cli",
      include: ["packages/cli/__tests__/**/*.test.ts"],
    },
  },
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
    test: {
      name: "meter",
      include: ["packages/meter/__tests__/**/*.test.ts"],
    },
  },
]);
