import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readState, writeState, listBotDirs, STATE_VERSION } from "../src/state-store.js";
import type { BotState } from "../src/state-store.js";

describe("state-store", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-state-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("readState", () => {
    it("returns undefined for missing state.json", () => {
      const result = readState(tempDir);
      expect(result).toBeUndefined();
    });

    it("returns undefined for corrupted state.json", () => {
      writeFileSync(join(tempDir, "state.json"), "not-valid-json{{{");
      const result = readState(tempDir);
      expect(result).toBeUndefined();
    });

    it("reads valid state.json", () => {
      const state: BotState = {
        name: "researcher",
        state: "running",
        pid: 12345,
        port: 7701,
        workspacePath: "/home/user/projects",
        startedAt: "2026-02-24T10:00:00Z",
      };
      writeState(tempDir, state);
      const result = readState(tempDir);
      expect(result).toEqual({ ...state, stateVersion: STATE_VERSION });
    });
  });

  describe("writeState", () => {
    it("creates directory if needed", () => {
      const nested = join(tempDir, "deep", "nested");
      const state: BotState = {
        name: "test",
        state: "stopped",
        workspacePath: "/tmp",
      };
      writeState(nested, state);
      const result = readState(nested);
      expect(result).toEqual({ ...state, stateVersion: STATE_VERSION });
    });

    it("round-trips all fields including optional ones", () => {
      const state: BotState = {
        name: "coder",
        state: "stopped",
        pid: 99999,
        port: 7702,
        workspacePath: "/home/user/app",
        startedAt: "2026-01-01T00:00:00Z",
        stoppedAt: "2026-01-01T01:00:00Z",
        exitCode: 0,
      };
      writeState(tempDir, state);
      expect(readState(tempDir)).toEqual({ ...state, stateVersion: STATE_VERSION });
    });

    it("overwrites existing state", () => {
      const state1: BotState = {
        name: "test",
        state: "running",
        pid: 111,
        workspacePath: "/tmp",
      };
      const state2: BotState = {
        name: "test",
        state: "stopped",
        exitCode: 1,
        workspacePath: "/tmp",
      };
      writeState(tempDir, state1);
      writeState(tempDir, state2);
      expect(readState(tempDir)).toEqual({ ...state2, stateVersion: STATE_VERSION });
    });
  });

  describe("listBotDirs", () => {
    it("returns empty array when mechaDir does not exist", () => {
      const result = listBotDirs(join(tempDir, "nonexistent"));
      expect(result).toEqual([]);
    });

    it("returns empty array when no dirs have state.json", () => {
      mkdirSync(join(tempDir, "alpha"), { recursive: true });
      mkdirSync(join(tempDir, "beta"), { recursive: true });
      const result = listBotDirs(tempDir);
      expect(result).toEqual([]);
    });

    it("lists directories that contain state.json", () => {
      mkdirSync(join(tempDir, "alpha"), { recursive: true });
      mkdirSync(join(tempDir, "beta"), { recursive: true });
      writeFileSync(join(tempDir, "alpha", "state.json"), "{}");
      writeFileSync(join(tempDir, "beta", "state.json"), "{}");
      const result = listBotDirs(tempDir);
      expect(result).toHaveLength(2);
      expect(result.sort()).toEqual([
        join(tempDir, "alpha"),
        join(tempDir, "beta"),
      ]);
    });

    it("ignores files in mechaDir", () => {
      mkdirSync(join(tempDir, "real-bot"), { recursive: true });
      writeFileSync(join(tempDir, "real-bot", "state.json"), "{}");
      writeFileSync(join(tempDir, "not-a-dir.txt"), "ignore me");
      const result = listBotDirs(tempDir);
      expect(result).toHaveLength(1);
      expect(result[0]).toContain("real-bot");
    });
  });
});
