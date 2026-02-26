import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { acquireCliLock, releaseCliLock, readCliLock } from "../src/cli-lock.js";

describe("cli-lock", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-lock-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("readCliLock", () => {
    it("returns null when no lock file exists", () => {
      expect(readCliLock(tempDir)).toBeNull();
    });

    it("returns null for corrupt JSON", () => {
      mkdirSync(tempDir, { recursive: true });
      writeFileSync(join(tempDir, "cli.lock"), "not-json{{{");
      expect(readCliLock(tempDir)).toBeNull();
    });

    it("returns null for JSON missing required fields", () => {
      mkdirSync(tempDir, { recursive: true });
      writeFileSync(join(tempDir, "cli.lock"), JSON.stringify({ pid: "not-a-number" }));
      expect(readCliLock(tempDir)).toBeNull();
    });

    it("returns lock info for valid lock file", () => {
      mkdirSync(tempDir, { recursive: true });
      const info = { pid: 12345, startedAt: "2026-01-01T00:00:00Z" };
      writeFileSync(join(tempDir, "cli.lock"), JSON.stringify(info));
      const result = readCliLock(tempDir);
      expect(result).toEqual(info);
    });
  });

  describe("acquireCliLock", () => {
    it("acquires lock when no lock file exists", () => {
      const acquired = acquireCliLock(tempDir);
      expect(acquired).toBe(true);

      const info = readCliLock(tempDir);
      expect(info).not.toBeNull();
      expect(info!.pid).toBe(process.pid);
      expect(info!.startedAt).toBeTruthy();
    });

    it("acquires lock when existing lock has dead PID", () => {
      mkdirSync(tempDir, { recursive: true });
      writeFileSync(
        join(tempDir, "cli.lock"),
        JSON.stringify({ pid: 999999999, startedAt: "2026-01-01T00:00:00Z" }),
      );

      const acquired = acquireCliLock(tempDir);
      expect(acquired).toBe(true);

      const info = readCliLock(tempDir);
      expect(info!.pid).toBe(process.pid);
    });

    it("rejects lock when existing lock has alive PID (self)", () => {
      // First acquire — uses our own PID
      acquireCliLock(tempDir);

      // Second acquire — should fail because our PID is alive
      const acquired = acquireCliLock(tempDir);
      expect(acquired).toBe(false);
    });

    it("acquires lock when lock file is corrupt", () => {
      mkdirSync(tempDir, { recursive: true });
      writeFileSync(join(tempDir, "cli.lock"), "corrupt{{{");

      const acquired = acquireCliLock(tempDir);
      expect(acquired).toBe(true);
    });

    it("creates mechaDir if it does not exist", () => {
      const nestedDir = join(tempDir, "nested", "deep");
      const acquired = acquireCliLock(nestedDir);
      expect(acquired).toBe(true);

      const info = readCliLock(nestedDir);
      expect(info!.pid).toBe(process.pid);
    });

    it("sets lock file permissions to 0o600", () => {
      acquireCliLock(tempDir);
      const { statSync } = require("node:fs");
      const stat = statSync(join(tempDir, "cli.lock"));
      expect(stat.mode & 0o777).toBe(0o600);
    });
  });

  describe("releaseCliLock", () => {
    it("removes lock file owned by this process", () => {
      acquireCliLock(tempDir);
      expect(readCliLock(tempDir)).not.toBeNull();

      releaseCliLock(tempDir);
      expect(readCliLock(tempDir)).toBeNull();
    });

    it("does not remove lock file owned by another PID", () => {
      mkdirSync(tempDir, { recursive: true });
      const foreignLock = { pid: 999999999, startedAt: "2026-01-01T00:00:00Z" };
      writeFileSync(join(tempDir, "cli.lock"), JSON.stringify(foreignLock));

      releaseCliLock(tempDir);
      // Lock should still be there — not ours to remove
      expect(readCliLock(tempDir)).toEqual(foreignLock);
    });

    it("does nothing when no lock file exists", () => {
      // Should not throw
      releaseCliLock(tempDir);
    });
  });
});
