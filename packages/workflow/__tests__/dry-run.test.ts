import { describe, it, expect } from "vitest";
import { createDryRunExecutor } from "../src/dry-run.js";

describe("createDryRunExecutor", () => {
  describe("without responses map", () => {
    it("returns a placeholder output with stepRunId", async () => {
      const executor = createDryRunExecutor();
      const result = await executor({
        bot: "any-bot",
        prompt: "Do something",
        stepRunId: "run-1:step-a:abc",
      });

      expect(result.output).toBe("[dry-run] step run-1:step-a:abc completed");
      expect(result.costUsd).toBe(0);
    });

    it("returns zero cost for every call", async () => {
      const executor = createDryRunExecutor();

      const r1 = await executor({ bot: "a", prompt: "p", stepRunId: "s1" });
      const r2 = await executor({ bot: "b", prompt: "q", stepRunId: "s2" });

      expect(r1.costUsd).toBe(0);
      expect(r2.costUsd).toBe(0);
    });

    it("includes different stepRunId in each response", async () => {
      const executor = createDryRunExecutor();

      const r1 = await executor({ bot: "bot", prompt: "p", stepRunId: "id-1" });
      const r2 = await executor({ bot: "bot", prompt: "p", stepRunId: "id-2" });

      expect(r1.output).toContain("id-1");
      expect(r2.output).toContain("id-2");
    });
  });

  describe("with responses map", () => {
    it("returns mapped response for known bot", async () => {
      const executor = createDryRunExecutor({
        researcher: { topics: ["AI", "ML"] },
        writer: "A draft article",
      });

      const result = await executor({
        bot: "researcher",
        prompt: "Find topics",
        stepRunId: "run-1:research:abc",
      });

      expect(result.output).toEqual({ topics: ["AI", "ML"] });
      expect(result.costUsd).toBe(0);
    });

    it("returns placeholder for bot not in map", async () => {
      const executor = createDryRunExecutor({
        researcher: "canned response",
      });

      const result = await executor({
        bot: "unknown-bot",
        prompt: "Do things",
        stepRunId: "run-1:unknown:xyz",
      });

      expect(result.output).toBe("[dry-run] step run-1:unknown:xyz completed");
    });

    it("handles falsy values in responses map", async () => {
      const executor = createDryRunExecutor({
        bot: null,
        other: "",
        zero: 0,
      } as Record<string, unknown>);

      const r1 = await executor({ bot: "bot", prompt: "p", stepRunId: "s1" });
      expect(r1.output).toBeNull();

      const r2 = await executor({ bot: "other", prompt: "p", stepRunId: "s2" });
      expect(r2.output).toBe("");

      const r3 = await executor({ bot: "zero", prompt: "p", stepRunId: "s3" });
      expect(r3.output).toBe(0);
    });
  });

  describe("no real calls", () => {
    it("never calls fetch or any external service", async () => {
      const originalFetch = globalThis.fetch;
      let fetchCalled = false;
      globalThis.fetch = (() => {
        fetchCalled = true;
        return Promise.resolve(new Response());
      }) as typeof fetch;

      try {
        const executor = createDryRunExecutor();
        await executor({ bot: "bot", prompt: "test", stepRunId: "s1" });
        await executor({ bot: "other", prompt: "test", stepRunId: "s2" });

        expect(fetchCalled).toBe(false);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("resolves immediately (async but no I/O)", async () => {
      const executor = createDryRunExecutor();
      const start = Date.now();

      for (let i = 0; i < 100; i++) {
        await executor({ bot: "bot", prompt: "p", stepRunId: `s${i}` });
      }

      const elapsed = Date.now() - start;
      // 100 calls should complete almost instantly (< 100ms)
      expect(elapsed).toBeLessThan(100);
    });
  });
});
