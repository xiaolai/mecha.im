import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { BotName } from "@mecha/core";
import type { ProcessInfo } from "@mecha/process";
import { makePm } from "./test-utils.js";

vi.mock("../src/task-check.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/task-check.js")>();
  return { ...orig, checkBotBusy: vi.fn().mockResolvedValue({ busy: false, activeSessions: 0 }) };
});

import { checkBotBusy } from "../src/task-check.js";
import { batchBotAction } from "../src/bot-batch.js";
const mockCheckBusy = vi.mocked(checkBotBusy);

const ALICE: ProcessInfo = { name: "alice" as BotName, state: "running", pid: 1, port: 7700, workspacePath: "/ws" };
const BOB: ProcessInfo = { name: "bob" as BotName, state: "running", pid: 2, port: 7701, workspacePath: "/ws2" };
const CHARLIE: ProcessInfo = { name: "charlie" as BotName, state: "stopped", workspacePath: "/ws3" };

describe("batchBotAction", () => {
  let mechaDir: string;
  afterEach(() => {
    if (mechaDir) rmSync(mechaDir, { recursive: true, force: true });
    mockCheckBusy.mockReset();
    mockCheckBusy.mockResolvedValue({ busy: false, activeSessions: 0 });
  });

  function writeConfig(name: string, config: Record<string, unknown>): void {
    const dir = join(mechaDir, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify(config));
  }

  describe("stop action", () => {
    it("stops all running bots, skips stopped", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "batch-stop-"));
      const pm = makePm([ALICE, BOB, CHARLIE]);
      const result = await batchBotAction({ pm, mechaDir, action: "stop" });

      expect(result.summary).toEqual({ succeeded: 2, skipped: 1, failed: 0 });
      expect(pm.stop).toHaveBeenCalledTimes(2);
      expect(result.results.find((r) => r.name === "charlie")?.status).toBe("skipped_stopped");
    });

    it("skips busy bots silently with idleOnly", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "batch-stop-"));
      mockCheckBusy.mockImplementation(async (_pm, name) => {
        if (name === "alice") return { busy: true, activeSessions: 2, lastActivity: "2026-01-01T00:00:00Z" };
        return { busy: false, activeSessions: 0 };
      });
      const pm = makePm([ALICE, BOB]);
      const result = await batchBotAction({ pm, mechaDir, action: "stop", idleOnly: true });

      expect(result.summary).toEqual({ succeeded: 1, skipped: 1, failed: 0 });
      expect(result.results.find((r) => r.name === "alice")?.status).toBe("skipped_busy");
      expect(result.results.find((r) => r.name === "alice")?.activeSessions).toBe(2);
    });

    it("force bypasses busy check", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "batch-stop-"));
      const pm = makePm([ALICE, BOB]);
      const result = await batchBotAction({ pm, mechaDir, action: "stop", force: true });

      expect(mockCheckBusy).not.toHaveBeenCalled();
      expect(result.summary).toEqual({ succeeded: 2, skipped: 0, failed: 0 });
    });

    it("dryRun returns status without executing", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "batch-stop-"));
      mockCheckBusy.mockImplementation(async (_pm, name) => {
        if (name === "bob") return { busy: true, activeSessions: 1 };
        return { busy: false, activeSessions: 0 };
      });
      const pm = makePm([ALICE, BOB]);
      const result = await batchBotAction({ pm, mechaDir, action: "stop", dryRun: true });

      expect(pm.stop).not.toHaveBeenCalled();
      expect(result.results.find((r) => r.name === "alice")?.status).toBe("succeeded");
      expect(result.results.find((r) => r.name === "bob")?.status).toBe("skipped_busy");
    });

    it("handles partial failure", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "batch-stop-"));
      const pm = makePm([ALICE, BOB]);
      vi.mocked(pm.stop).mockImplementation(async (name) => {
        if (name === "bob") throw new Error("Process not responding");
      });
      const result = await batchBotAction({ pm, mechaDir, action: "stop" });

      expect(result.summary).toEqual({ succeeded: 1, skipped: 0, failed: 1 });
      expect(result.results.find((r) => r.name === "bob")?.error).toBe("Process not responding");
    });

    it("returns empty results when no bots exist", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "batch-stop-"));
      const pm = makePm([]);
      const result = await batchBotAction({ pm, mechaDir, action: "stop" });

      expect(result.results).toHaveLength(0);
      expect(result.summary).toEqual({ succeeded: 0, skipped: 0, failed: 0 });
    });

    it("calls onProgress for each result", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "batch-stop-"));
      const pm = makePm([ALICE, CHARLIE]);
      const progress: string[] = [];
      await batchBotAction({
        pm, mechaDir, action: "stop",
        onProgress: (r) => progress.push(r.name),
      });

      expect(progress).toContain("alice");
      expect(progress).toContain("charlie");
    });

    it("fails busy bots by default (without idleOnly or force)", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "batch-stop-"));
      mockCheckBusy.mockResolvedValue({ busy: true, activeSessions: 3 });
      const pm = makePm([ALICE]);
      const result = await batchBotAction({ pm, mechaDir, action: "stop" });

      expect(result.summary).toEqual({ succeeded: 0, skipped: 0, failed: 1 });
      expect(result.results[0]?.status).toBe("failed");
      expect(result.results[0]?.error).toContain("active session");
      expect(pm.stop).not.toHaveBeenCalled();
    });

    it("filters by names when provided", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "batch-stop-"));
      const pm = makePm([ALICE, BOB]);
      const result = await batchBotAction({ pm, mechaDir, action: "stop", names: ["alice"] });

      expect(result.summary).toEqual({ succeeded: 1, skipped: 0, failed: 0 });
      expect(pm.stop).toHaveBeenCalledTimes(1);
      expect(pm.stop).toHaveBeenCalledWith("alice");
    });

    it("clamps concurrency to minimum 1", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "batch-stop-"));
      const pm = makePm([ALICE]);
      const result = await batchBotAction({ pm, mechaDir, action: "stop", concurrency: 0 });

      expect(result.summary.succeeded).toBe(1);
    });
  });

  describe("restart action", () => {
    it("restarts all bots from config", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "batch-restart-"));
      writeConfig("alice", { port: 7700, token: "t", workspace: "/ws" });
      writeConfig("bob", { port: 7701, token: "t", workspace: "/ws2" });
      const pm = makePm([ALICE, BOB]);
      vi.mocked(pm.spawn).mockResolvedValue(ALICE);

      const result = await batchBotAction({ pm, mechaDir, action: "restart" });

      expect(result.summary).toEqual({ succeeded: 2, skipped: 0, failed: 0 });
      expect(pm.stop).toHaveBeenCalledTimes(2);
      expect(pm.spawn).toHaveBeenCalledTimes(2);
    });

    it("uses kill when force is set", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "batch-restart-"));
      writeConfig("alice", { port: 7700, token: "t", workspace: "/ws" });
      const pm = makePm([ALICE]);
      vi.mocked(pm.spawn).mockResolvedValue(ALICE);

      await batchBotAction({ pm, mechaDir, action: "restart", force: true });

      expect(pm.kill).toHaveBeenCalledWith("alice");
      expect(pm.stop).not.toHaveBeenCalled();
    });

    it("fails when config is missing", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "batch-restart-"));
      // No config written
      const pm = makePm([ALICE]);

      const result = await batchBotAction({ pm, mechaDir, action: "restart" });

      expect(result.summary).toEqual({ succeeded: 0, skipped: 0, failed: 1 });
      expect(result.results[0]?.error).toBe("Config not found");
    });

    it("spawns stopped bots without stopping first", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "batch-restart-"));
      writeConfig("charlie", { port: 7702, token: "t", workspace: "/ws3" });
      const pm = makePm([CHARLIE]);
      vi.mocked(pm.spawn).mockResolvedValue(CHARLIE);

      const result = await batchBotAction({ pm, mechaDir, action: "restart" });

      expect(result.summary).toEqual({ succeeded: 1, skipped: 0, failed: 0 });
      expect(pm.stop).not.toHaveBeenCalled();
      expect(pm.kill).not.toHaveBeenCalled();
      expect(pm.spawn).toHaveBeenCalledTimes(1);
    });

    it("dryRun for restart checks config existence", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "batch-restart-"));
      // No config written for alice
      const pm = makePm([ALICE]);

      const result = await batchBotAction({ pm, mechaDir, action: "restart", dryRun: true });

      expect(pm.stop).not.toHaveBeenCalled();
      expect(pm.spawn).not.toHaveBeenCalled();
      expect(result.results[0]?.status).toBe("failed");
      expect(result.results[0]?.error).toBe("Config not found");
    });

    it("dryRun for restart succeeds when config exists", async () => {
      mechaDir = mkdtempSync(join(tmpdir(), "batch-restart-"));
      writeConfig("alice", { port: 7700, token: "t", workspace: "/ws" });
      const pm = makePm([ALICE]);

      const result = await batchBotAction({ pm, mechaDir, action: "restart", dryRun: true });

      expect(result.results[0]?.status).toBe("succeeded");
      expect(pm.spawn).not.toHaveBeenCalled();
    });
  });
});
