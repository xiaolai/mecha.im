import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/dashboard/__tests__/integration.test.ts"],
    testTimeout: 120_000,
  },
});
