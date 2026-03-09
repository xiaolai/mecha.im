import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, statSync } from "node:fs";
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

    it("returns null for pid=0", () => {
      mkdirSync(tempDir, { recursive: true });
      writeFileSync(join(tempDir, "cli.lock"), JSON.stringify({ pid: 0, startedAt: "2026-01-01T00:00:00Z" }));
      expect(readCliLock(tempDir)).toBeNull();
    });

    it("returns null for negative pid", () => {
      mkdirSync(tempDir, { recursive: true });
      writeFileSync(join(tempDir, "cli.lock"), JSON.stringify({ pid: -1, startedAt: "2026-01-01T00:00:00Z" }));
      expect(readCliLock(tempDir)).toBeNull();
    });

    it("returns null for non-integer pid", () => {
      mkdirSync(tempDir, { recursive: true });
      writeFileSync(join(tempDir, "cli.lock"), JSON.stringify({ pid: 1.5, startedAt: "2026-01-01T00:00:00Z" }));
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
      ["start", ["node", "mecha", "start"]],
      ["stop", ["node", "mecha", "stop"]],
      ["restart", ["node", "mecha", "restart"]],
      ["init", ["node", "mecha", "init"]],
      ["agent start", ["node", "mecha", "agent", "start"]],
      ["meter start", ["node", "mecha", "meter", "start"]],
      ["meter stop", ["node", "mecha", "meter", "stop"]],
      ["acl grant", ["node", "mecha", "acl", "grant"]],
      ["acl revoke", ["node", "mecha", "acl", "revoke"]],
      ["auth add", ["node", "mecha", "auth", "add"]],
      ["auth rm", ["node", "mecha", "auth", "rm"]],
      ["auth default", ["node", "mecha", "auth", "default"]],
      ["auth tag", ["node", "mecha", "auth", "tag"]],
      ["auth switch", ["node", "mecha", "auth", "switch"]],
      ["auth renew", ["node", "mecha", "auth", "renew"]],
      ["dashboard serve", ["node", "mecha", "dashboard", "serve"]],
    ])("returns true for %s", (_label, argv) => {
      expect(needsLock(argv)).toBe(true);
    });

    // Read-only commands skip the lock
    it.each([
      ["bot spawn", ["node", "mecha", "bot", "spawn", "alice", "/path"]],
      ["bot start", ["node", "mecha", "bot", "start", "alice"]],
      ["bot stop", ["node", "mecha", "bot", "stop", "alice"]],
      ["bot kill", ["node", "mecha", "bot", "kill", "alice"]],
      ["bot restart", ["node", "mecha", "bot", "restart", "alice"]],
      ["bot remove", ["node", "mecha", "bot", "remove", "alice"]],
      ["bot configure", ["node", "mecha", "bot", "configure", "alice"]],
      ["bot ls", ["node", "mecha", "bot", "ls"]],
      ["bot status", ["node", "mecha", "bot", "status", "alice"]],
      ["bot logs", ["node", "mecha", "bot", "logs", "alice"]],
      ["bot find", ["node", "mecha", "bot", "find"]],
      ["bot chat", ["node", "mecha", "bot", "chat", "alice"]],
      ["bot sessions", ["node", "mecha", "bot", "sessions", "list", "alice"]],
      ["cost", ["node", "mecha", "cost"]],
      ["doctor", ["node", "mecha", "doctor"]],
      ["tools", ["node", "mecha", "tools"]],
      ["meter status", ["node", "mecha", "meter", "status"]],
      ["schedule add", ["node", "mecha", "schedule", "add"]],
      ["schedule remove", ["node", "mecha", "schedule", "remove"]],
      ["schedule pause", ["node", "mecha", "schedule", "pause"]],
      ["schedule resume", ["node", "mecha", "schedule", "resume"]],
      ["schedule run", ["node", "mecha", "schedule", "run"]],
      ["schedule history", ["node", "mecha", "schedule", "history"]],
      ["acl show", ["node", "mecha", "acl", "show"]],
      ["node ls", ["node", "mecha", "node", "ls"]],
      ["node add", ["node", "mecha", "node", "add"]],
      ["node rm", ["node", "mecha", "node", "rm"]],
      ["auth ls", ["node", "mecha", "auth", "ls"]],
      ["auth test", ["node", "mecha", "auth", "test"]],
      ["budget set", ["node", "mecha", "budget", "set"]],
      ["budget rm", ["node", "mecha", "budget", "rm"]],
      ["budget ls", ["node", "mecha", "budget", "ls"]],
      ["sandbox show", ["node", "mecha", "sandbox", "show"]],
      ["agent status", ["node", "mecha", "agent", "status"]],
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
      expect(needsLock(["node", "mecha", "--json", "bot", "spawn", "alice", "/path"])).toBe(false);
      expect(needsLock(["node", "mecha", "--verbose", "bot", "ls"])).toBe(false);
    });
  });
});
