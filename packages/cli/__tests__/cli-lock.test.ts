import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { acquireCliLock, releaseCliLock, readCliLock, needsLock } from "../src/cli-lock.js";

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

  describe("needsLock", () => {
    // Mutating commands need the lock
    it.each([
      ["spawn", ["node", "mecha", "spawn", "alice", "/path"]],
      ["stop", ["node", "mecha", "stop", "alice"]],
      ["kill", ["node", "mecha", "kill", "alice"]],
      ["init", ["node", "mecha", "init"]],
      ["configure", ["node", "mecha", "configure"]],
      ["agent", ["node", "mecha", "agent", "start"]],
      ["meter start", ["node", "mecha", "meter", "start"]],
      ["meter stop", ["node", "mecha", "meter", "stop"]],
      ["schedule add", ["node", "mecha", "schedule", "add"]],
      ["schedule remove", ["node", "mecha", "schedule", "remove"]],
      ["schedule pause", ["node", "mecha", "schedule", "pause"]],
      ["schedule resume", ["node", "mecha", "schedule", "resume"]],
      ["schedule run", ["node", "mecha", "schedule", "run"]],
      ["acl grant", ["node", "mecha", "acl", "grant"]],
      ["acl revoke", ["node", "mecha", "acl", "revoke"]],
      ["node add", ["node", "mecha", "node", "add"]],
      ["node rm", ["node", "mecha", "node", "rm"]],
      ["auth add", ["node", "mecha", "auth", "add"]],
      ["auth rm", ["node", "mecha", "auth", "rm"]],
      ["auth set-default", ["node", "mecha", "auth", "set-default"]],
      ["budget set", ["node", "mecha", "budget", "set"]],
      ["budget rm", ["node", "mecha", "budget", "rm"]],
    ])("returns true for %s", (_label, argv) => {
      expect(needsLock(argv)).toBe(true);
    });

    // Read-only commands skip the lock
    it.each([
      ["ls", ["node", "mecha", "ls"]],
      ["status", ["node", "mecha", "status", "alice"]],
      ["logs", ["node", "mecha", "logs", "alice"]],
      ["cost", ["node", "mecha", "cost"]],
      ["doctor", ["node", "mecha", "doctor"]],
      ["find", ["node", "mecha", "find", "researcher"]],
      ["chat", ["node", "mecha", "chat", "alice"]],
      ["sessions", ["node", "mecha", "sessions", "alice"]],
      ["tools", ["node", "mecha", "tools"]],
      ["meter status", ["node", "mecha", "meter", "status"]],
      ["schedule history", ["node", "mecha", "schedule", "history"]],
      ["acl show", ["node", "mecha", "acl", "show"]],
      ["node ls", ["node", "mecha", "node", "ls"]],
      ["auth ls", ["node", "mecha", "auth", "ls"]],
      ["budget ls", ["node", "mecha", "budget", "ls"]],
      ["sandbox show", ["node", "mecha", "sandbox", "show"]],
    ])("returns false for %s", (_label, argv) => {
      expect(needsLock(argv)).toBe(false);
    });

    it("returns false for --help", () => {
      expect(needsLock(["node", "mecha", "--help"])).toBe(false);
    });

    it("returns false for --version", () => {
      expect(needsLock(["node", "mecha", "--version"])).toBe(false);
    });

    it("returns false for empty args", () => {
      expect(needsLock(["node", "mecha"])).toBe(false);
    });

    it("skips flags when finding command", () => {
      expect(needsLock(["node", "mecha", "--json", "spawn", "alice", "/path"])).toBe(true);
      expect(needsLock(["node", "mecha", "--verbose", "ls"])).toBe(false);
    });
  });
});
