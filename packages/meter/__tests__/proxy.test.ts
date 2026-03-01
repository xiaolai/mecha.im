import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseCasaPath, buildUpstreamHeaders,
  buildMeterEvent, enforceBudget, reloadBudgets, recordEvent,
  parseModelAndStream, stripHopByHop, MAX_BODY_BYTES,
  ESTIMATED_REQUEST_COST_USD,
  getDroppedEventCount, resetDroppedEventCount,
} from "../src/proxy.js";
import type { ProxyContext } from "../src/proxy.js";
import { loadPricing, initPricing } from "../src/pricing.js";
import { createHotCounters } from "../src/hot-counters.js";
import { emptySummary, todayUTC } from "../src/query.js";
import { readEventsForDate, utcDate } from "../src/events.js";
import { writeBudgets } from "../src/budgets.js";
import type { CasaRegistryEntry, BudgetConfig } from "../src/types.js";

function emptyBudgets(): BudgetConfig {
  return { global: {}, byCasa: {}, byAuthProfile: {}, byTag: {} };
}

function makeCasaInfo(overrides: Partial<CasaRegistryEntry> = {}): CasaRegistryEntry {
  return { name: "researcher", authProfile: "default", workspace: "/tmp/ws", tags: [], ...overrides };
}

function makeCtx(meterDir: string, overrides: Partial<ProxyContext> = {}): ProxyContext {
  initPricing(meterDir);
  return {
    meterDir,
    pricing: loadPricing(meterDir),
    registry: new Map(),
    counters: createHotCounters("2026-02-26"),
    budgets: emptyBudgets(),
    pendingRequests: new Map(),
    ...overrides,
  };
}

describe("proxy", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe("parseCasaPath", () => {
    it("parses /casa/{name}/v1/messages", () => {
      const result = parseCasaPath("/casa/researcher/v1/messages");
      expect(result).toEqual({ casa: "researcher", upstreamPath: "/v1/messages" });
    });

    it("parses CASA name with hyphens and numbers", () => {
      const result = parseCasaPath("/casa/my-bot-3/v1/messages");
      expect(result).toEqual({ casa: "my-bot-3", upstreamPath: "/v1/messages" });
    });

    it("returns null for non-matching paths", () => {
      expect(parseCasaPath("/v1/messages")).toBeNull();
      expect(parseCasaPath("/casa/")).toBeNull();
      expect(parseCasaPath("/casa/name")).toBeNull();
      expect(parseCasaPath("/other/path")).toBeNull();
    });

    it("returns null for invalid CASA names", () => {
      expect(parseCasaPath("/casa/UPPER/v1/messages")).toBeNull();
      expect(parseCasaPath("/casa/has_underscore/v1/messages")).toBeNull();
    });
  });

  describe("buildUpstreamHeaders", () => {
    it("sets host to api.anthropic.com", () => {
      const headers = buildUpstreamHeaders({ "host": "localhost:7600" });
      expect(headers["host"]).toBe("api.anthropic.com");
    });

    it("strips hop-by-hop headers", () => {
      const headers = buildUpstreamHeaders({
        "connection": "keep-alive",
        "keep-alive": "timeout=5",
        "transfer-encoding": "chunked",
        "x-api-key": "sk-test",
      });
      expect(headers["connection"]).toBeUndefined();
      expect(headers["keep-alive"]).toBeUndefined();
      expect(headers["transfer-encoding"]).toBeUndefined();
      expect(headers["x-api-key"]).toBe("sk-test");
    });

    it("passes through auth headers unchanged", () => {
      const headers = buildUpstreamHeaders({
        "x-api-key": "sk-ant-test",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      });
      expect(headers["x-api-key"]).toBe("sk-ant-test");
      expect(headers["anthropic-version"]).toBe("2023-06-01");
    });

    it("joins array header values", () => {
      const headers = buildUpstreamHeaders({
        "accept": ["application/json", "text/plain"],
      });
      expect(headers["accept"]).toBe("application/json, text/plain");
    });

    it("skips undefined values", () => {
      const headers = buildUpstreamHeaders({ "x-custom": undefined });
      expect(headers["x-custom"]).toBeUndefined();
    });
  });

  describe("buildMeterEvent", () => {
    it("builds event with computed cost for 200 status", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-proxy-"));
      const ctx = makeCtx(tempDir);
      const casaInfo = makeCasaInfo({ tags: ["exp"] });
      const startMs = Date.now() - 100;

      const event = buildMeterEvent(ctx, startMs, "researcher", casaInfo, "claude-sonnet-4-20250514", false, 200, {
        inputTokens: 100, outputTokens: 50,
        cacheCreationTokens: 0, cacheReadTokens: 0,
        modelActual: "claude-sonnet-4-20250514", ttftMs: 42,
      });

      expect(event.id).toBeTruthy();
      expect(event.casa).toBe("researcher");
      expect(event.authProfile).toBe("default");
      expect(event.tags).toEqual(["exp"]);
      expect(event.model).toBe("claude-sonnet-4-20250514");
      expect(event.status).toBe(200);
      expect(event.inputTokens).toBe(100);
      expect(event.outputTokens).toBe(50);
      expect(event.costUsd).toBeGreaterThan(0);
      expect(event.ttftMs).toBe(42);
      expect(event.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("sets costUsd to 0 for non-200 status", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-proxy-"));
      const ctx = makeCtx(tempDir);
      const casaInfo = makeCasaInfo();

      const event = buildMeterEvent(ctx, Date.now(), "researcher", casaInfo, "claude-sonnet-4-20250514", false, 500, {
        inputTokens: 100, outputTokens: 50,
        cacheCreationTokens: 0, cacheReadTokens: 0,
        modelActual: "claude-sonnet-4-20250514", ttftMs: null,
      });

      expect(event.costUsd).toBe(0);
      expect(event.status).toBe(500);
    });

    it("falls back to model when modelActual is empty", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-proxy-"));
      const ctx = makeCtx(tempDir);
      const casaInfo = makeCasaInfo();

      const event = buildMeterEvent(ctx, Date.now(), "researcher", casaInfo, "claude-sonnet-4-20250514", true, 200, {
        inputTokens: 10, outputTokens: 5,
        cacheCreationTokens: 0, cacheReadTokens: 0,
        modelActual: "", ttftMs: null,
      });

      expect(event.modelActual).toBe("claude-sonnet-4-20250514");
    });
  });

  describe("enforceBudget", () => {
    it("allows when no budgets set", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-proxy-"));
      const ctx = makeCtx(tempDir);
      const result = enforceBudget(ctx, "researcher", makeCasaInfo());
      expect(result.allowed).toBe(true);
      expect(result.warnings).toEqual([]);
    });

    it("blocks when global budget exceeded", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-proxy-"));
      const ctx = makeCtx(tempDir, {
        budgets: { global: { dailyUsd: 1 }, byCasa: {}, byAuthProfile: {}, byTag: {} },
      });
      // Simulate accumulated cost
      ctx.counters.global.today.costUsd = 1.50;

      const result = enforceBudget(ctx, "researcher", makeCasaInfo());
      expect(result.allowed).toBe(false);
      expect(result.exceeded).toContain("exceeded daily limit");
    });

    it("uses perCasa bucket when present", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-proxy-"));
      const ctx = makeCtx(tempDir, {
        budgets: { global: {}, byCasa: { researcher: { dailyUsd: 2 } }, byAuthProfile: {}, byTag: {} },
      });
      // Add a CASA bucket
      ctx.counters.byCasa["researcher"] = { today: { ...emptySummary(), costUsd: 3 }, thisMonth: emptySummary() };

      const result = enforceBudget(ctx, "researcher", makeCasaInfo());
      expect(result.allowed).toBe(false);
      expect(result.exceeded).toContain("CASA researcher");
    });

    it("uses perAuth bucket when present", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-proxy-"));
      const ctx = makeCtx(tempDir, {
        budgets: { global: {}, byCasa: {}, byAuthProfile: { work: { dailyUsd: 5 } }, byTag: {} },
      });
      ctx.counters.byAuth["work"] = { today: { ...emptySummary(), costUsd: 6 }, thisMonth: emptySummary() };

      const result = enforceBudget(ctx, "r", makeCasaInfo({ authProfile: "work" }));
      expect(result.allowed).toBe(false);
      expect(result.exceeded).toContain("auth work");
    });

    it("collects tag summaries and enforces tag budgets", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-proxy-"));
      const ctx = makeCtx(tempDir, {
        budgets: { global: {}, byCasa: {}, byAuthProfile: {}, byTag: { exp: { dailyUsd: 1 } } },
      });
      ctx.counters.byTag["exp"] = { today: { ...emptySummary(), costUsd: 2 }, thisMonth: emptySummary() };

      const result = enforceBudget(ctx, "r", makeCasaInfo({ tags: ["exp"] }));
      expect(result.allowed).toBe(false);
      expect(result.exceeded).toContain("tag exp");
    });

    it("skips tags with no counter bucket", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-proxy-"));
      const ctx = makeCtx(tempDir, {
        budgets: { global: {}, byCasa: {}, byAuthProfile: {}, byTag: { exp: { dailyUsd: 1 } } },
      });
      // No tag bucket exists

      const result = enforceBudget(ctx, "r", makeCasaInfo({ tags: ["exp"] }));
      expect(result.allowed).toBe(true);
    });

    it("includes pending request cost in budget check", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-proxy-"));
      const ctx = makeCtx(tempDir, {
        budgets: { global: { dailyUsd: 0.10 }, byCasa: {}, byAuthProfile: {}, byTag: {} },
      });
      // Cost is under limit
      ctx.counters.global.today.costUsd = 0.05;
      expect(enforceBudget(ctx, "r", makeCasaInfo()).allowed).toBe(true);

      // Add 3 pending requests → 3 * $0.03 = $0.09, total = $0.14 > $0.10
      ctx.pendingRequests.set("r", 3);
      const result = enforceBudget(ctx, "r", makeCasaInfo());
      expect(result.allowed).toBe(false);
      expect(result.exceeded).toContain("exceeded daily limit");
    });

    it("ESTIMATED_REQUEST_COST_USD is $0.03", () => {
      expect(ESTIMATED_REQUEST_COST_USD).toBe(0.03);
    });
  });

  describe("reloadBudgets", () => {
    it("reads budgets from disk", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-proxy-"));
      const ctx = makeCtx(tempDir);
      expect(ctx.budgets.global).toEqual({});

      // Write budgets to disk then reload
      writeBudgets(tempDir, { global: { dailyUsd: 42 }, byCasa: {}, byAuthProfile: {}, byTag: {} });

      reloadBudgets(ctx);
      expect(ctx.budgets.global.dailyUsd).toBe(42);
    });
  });

  describe("recordEvent", () => {
    it("appends event to disk and ingests into hot counters", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-proxy-"));
      const ctx = makeCtx(tempDir);

      const event = buildMeterEvent(ctx, Date.now(), "researcher", makeCasaInfo(), "claude-sonnet-4-20250514", false, 200, {
        inputTokens: 100, outputTokens: 50,
        cacheCreationTokens: 0, cacheReadTokens: 0,
        modelActual: "claude-sonnet-4-20250514", ttftMs: 10,
      });

      recordEvent(ctx, event);

      // Hot counters updated
      expect(ctx.counters.global.today.requests).toBe(1);
      expect(ctx.counters.global.today.inputTokens).toBe(100);

      // Event written to disk
      const events = readEventsForDate(tempDir, utcDate(new Date().toISOString()));
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe(event.id);
    });

    it("logs error and skips ingestion when disk write fails", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-proxy-"));
      const ctx = makeCtx(tempDir);
      // Point to non-existent read-only dir to cause write failure
      ctx.meterDir = "/nonexistent/path/meter";

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const event = buildMeterEvent(ctx, Date.now(), "r", makeCasaInfo(), "m", false, 200, {
        inputTokens: 1, outputTokens: 1,
        cacheCreationTokens: 0, cacheReadTokens: 0,
        modelActual: "m", ttftMs: null,
      });

      recordEvent(ctx, event);

      // Ingestion did NOT happen — hot counters must not update on write failure
      expect(ctx.counters.global.today.requests).toBe(0);
      // Error was logged (structured JSON via createLogger)
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to write event"),
      );
    });
  });

  describe("parseModelAndStream", () => {
    it("extracts model and stream from valid JSON", () => {
      const body = Buffer.from(JSON.stringify({ model: "claude-sonnet-4-20250514", stream: true }));
      expect(parseModelAndStream(body)).toEqual({ model: "claude-sonnet-4-20250514", stream: true });
    });

    it("returns defaults for non-stream request", () => {
      const body = Buffer.from(JSON.stringify({ model: "claude-sonnet-4-20250514" }));
      expect(parseModelAndStream(body)).toEqual({ model: "claude-sonnet-4-20250514", stream: false });
    });

    it("returns defaults for invalid JSON", () => {
      const body = Buffer.from("not json");
      expect(parseModelAndStream(body)).toEqual({ model: "", stream: false });
    });

    it("returns defaults for empty body", () => {
      const body = Buffer.from("");
      expect(parseModelAndStream(body)).toEqual({ model: "", stream: false });
    });

    it("handles non-string model field", () => {
      const body = Buffer.from(JSON.stringify({ model: 42, stream: true }));
      expect(parseModelAndStream(body)).toEqual({ model: "", stream: true });
    });

    it("handles non-boolean stream field", () => {
      const body = Buffer.from(JSON.stringify({ model: "m", stream: "yes" }));
      expect(parseModelAndStream(body)).toEqual({ model: "m", stream: false });
    });
  });

  describe("stripHopByHop", () => {
    it("removes hop-by-hop headers", () => {
      const headers = stripHopByHop({
        "connection": "keep-alive",
        "keep-alive": "timeout=5",
        "transfer-encoding": "chunked",
        "content-type": "application/json",
        "x-custom": "value",
      });
      expect(headers["connection"]).toBeUndefined();
      expect(headers["keep-alive"]).toBeUndefined();
      expect(headers["transfer-encoding"]).toBeUndefined();
      expect(headers["content-type"]).toBe("application/json");
      expect(headers["x-custom"]).toBe("value");
    });

    it("does not mutate original headers", () => {
      const original = { "connection": "close", "x-test": "ok" };
      stripHopByHop(original);
      expect(original["connection"]).toBe("close");
    });
  });

  describe("MAX_BODY_BYTES", () => {
    it("is 32MB", () => {
      expect(MAX_BODY_BYTES).toBe(32 * 1024 * 1024);
    });
  });

  describe("getDroppedEventCount / resetDroppedEventCount", () => {
    afterEach(() => resetDroppedEventCount());

    it("tracks dropped events from failed writes", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-proxy-"));
      const ctx = makeCtx(tempDir);
      ctx.meterDir = "/nonexistent/path/meter";

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const before = getDroppedEventCount();

      const event = buildMeterEvent(ctx, Date.now(), "r", makeCasaInfo(), "m", false, 200, {
        inputTokens: 1, outputTokens: 1,
        cacheCreationTokens: 0, cacheReadTokens: 0,
        modelActual: "m", ttftMs: null,
      });

      recordEvent(ctx, event);
      expect(getDroppedEventCount()).toBe(before + 1);
      consoleSpy.mockRestore();
    });

    it("resets counter to zero", () => {
      resetDroppedEventCount();
      expect(getDroppedEventCount()).toBe(0);
    });
  });
});
