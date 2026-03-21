import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readProxyInfo, writeProxyInfo, deleteProxyInfo,
  isPidAlive, cleanStaleProxy, getMeterStatus,
} from "../src/lifecycle.js";
import type { ProxyInfo } from "../src/types.js";

describe("lifecycle", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  describe("readProxyInfo", () => {
    it("returns null when file does not exist", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-life-"));
      expect(readProxyInfo(tempDir)).toBeNull();
    });

    it("reads valid proxy.json", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-life-"));
      const info: ProxyInfo = { port: 7600, pid: 12345, required: false, startedAt: "2026-02-26T00:00:00Z" };
      writeFileSync(join(tempDir, "proxy.json"), JSON.stringify(info));

      const result = readProxyInfo(tempDir);
      expect(result).toEqual(info);
    });

    it("returns null for malformed JSON", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-life-"));
      writeFileSync(join(tempDir, "proxy.json"), "not json");
      expect(readProxyInfo(tempDir)).toBeNull();
    });

    it("returns null for missing port/pid fields", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-life-"));
      writeFileSync(join(tempDir, "proxy.json"), '{"something":"else"}');
      expect(readProxyInfo(tempDir)).toBeNull();
    });
  });

  describe("writeProxyInfo", () => {
    it("writes proxy.json atomically", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-life-"));
      const info: ProxyInfo = { port: 7600, pid: process.pid, required: true, startedAt: "2026-02-26T00:00:00Z" };
      writeProxyInfo(tempDir, info);

      const raw = readFileSync(join(tempDir, "proxy.json"), "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.port).toBe(7600);
      expect(parsed.required).toBe(true);
    });

    it("creates directory if needed", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-life-"));
      const nested = join(tempDir, "sub", "dir");
      const info: ProxyInfo = { port: 7600, pid: 1, required: false, startedAt: "x" };
      writeProxyInfo(nested, info);
      expect(existsSync(join(nested, "proxy.json"))).toBe(true);
    });
  });

  describe("deleteProxyInfo", () => {
    it("deletes proxy.json", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-life-"));
      writeFileSync(join(tempDir, "proxy.json"), "{}");
      deleteProxyInfo(tempDir);
      expect(existsSync(join(tempDir, "proxy.json"))).toBe(false);
    });

    it("does not throw if file does not exist", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-life-"));
      expect(() => deleteProxyInfo(tempDir)).not.toThrow();
    });
  });

  describe("isPidAlive", () => {
    it("returns true for current process", () => {
      expect(isPidAlive(process.pid)).toBe(true);
    });

    it("returns false for impossible pid", () => {
      // pid 999999999 is extremely unlikely to be alive
      expect(isPidAlive(999999999)).toBe(false);
    });
  });

  describe("cleanStaleProxy", () => {
    it("returns false when no proxy.json exists", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-life-"));
      expect(cleanStaleProxy(tempDir)).toBe(false);
    });

    it("cleans stale proxy.json with dead pid", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-life-"));
      writeFileSync(join(tempDir, "proxy.json"), JSON.stringify({ port: 7600, pid: 999999999, required: false, startedAt: "x" }));

      expect(cleanStaleProxy(tempDir)).toBe(true);
      expect(existsSync(join(tempDir, "proxy.json"))).toBe(false);
    });

    it("does not clean when pid is alive", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-life-"));
      writeFileSync(join(tempDir, "proxy.json"), JSON.stringify({ port: 7600, pid: process.pid, required: false, startedAt: "x" }));

      expect(cleanStaleProxy(tempDir)).toBe(false);
      expect(existsSync(join(tempDir, "proxy.json"))).toBe(true);
    });
  });

  describe("getMeterStatus", () => {
    it("returns not running when no proxy.json", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-life-"));
      const status = getMeterStatus(tempDir);
      expect(status.running).toBe(false);
    });

    it("returns running for alive process", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-life-"));
      writeFileSync(join(tempDir, "proxy.json"), JSON.stringify({
        port: 7600, pid: process.pid, required: true, startedAt: "2026-02-26T00:00:00Z",
      }));

      const status = getMeterStatus(tempDir);
      expect(status.running).toBe(true);
      expect(status.port).toBe(7600);
      expect(status.pid).toBe(process.pid);
      expect(status.required).toBe(true);
    });

    it("cleans stale and returns not running for dead pid", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-life-"));
      writeFileSync(join(tempDir, "proxy.json"), JSON.stringify({
        port: 7600, pid: 999999999, required: false, startedAt: "x",
      }));

      const status = getMeterStatus(tempDir);
      expect(status.running).toBe(false);
      expect(existsSync(join(tempDir, "proxy.json"))).toBe(false);
    });
  });
});
