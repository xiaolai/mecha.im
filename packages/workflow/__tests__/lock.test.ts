import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { acquireLock, releaseLock, isLocked } from "../src/lock.js";

describe("Workspace locks", () => {
  let lockDir: string;

  beforeEach(() => {
    lockDir = mkdtempSync(join(tmpdir(), "mecha-lock-"));
  });

  describe("acquireLock", () => {
    it("creates a lock file with JSON content", () => {
      const handle = acquireLock(lockDir, "/workspace/project/file.ts", "alice");

      expect(existsSync(handle.lockPath)).toBe(true);
      const content = JSON.parse(readFileSync(handle.lockPath, "utf-8"));
      expect(content.resource).toBe("/workspace/project/file.ts");
      expect(content.owner).toBe("alice");
      expect(content.acquiredAt).toBeTruthy();
    });

    it("returns a handle with lock info", () => {
      const handle = acquireLock(lockDir, "/src/index.ts", "bot-1");

      expect(handle.info.resource).toBe("/src/index.ts");
      expect(handle.info.owner).toBe("bot-1");
      expect(typeof handle.info.acquiredAt).toBe("string");
    });

    it("uses default owner when not specified", () => {
      const handle = acquireLock(lockDir, "/readme.md");

      expect(handle.info.owner).toMatch(/^pid-\d+$/);
    });

    it("creates lockDir if it does not exist", () => {
      const nested = join(lockDir, "sub", "dir");
      const handle = acquireLock(nested, "/file.ts");

      expect(existsSync(handle.lockPath)).toBe(true);
    });
  });

  describe("double-acquire throws", () => {
    it("throws when the same resource is already locked", () => {
      acquireLock(lockDir, "/workspace/shared.ts", "alice");

      expect(() => acquireLock(lockDir, "/workspace/shared.ts", "bob")).toThrow(
        "Resource already locked",
      );
    });

    it("error message includes original owner", () => {
      acquireLock(lockDir, "/data/config.json", "alice");

      expect(() => acquireLock(lockDir, "/data/config.json", "bob")).toThrow(
        /alice/,
      );
    });
  });

  describe("releaseLock", () => {
    it("removes the lock file", () => {
      const handle = acquireLock(lockDir, "/file.ts");
      expect(existsSync(handle.lockPath)).toBe(true);

      releaseLock(handle);
      expect(existsSync(handle.lockPath)).toBe(false);
    });

    it("is safe to call on an already-released lock", () => {
      const handle = acquireLock(lockDir, "/file.ts");
      releaseLock(handle);

      // Second call should not throw
      releaseLock(handle);
      expect(existsSync(handle.lockPath)).toBe(false);
    });

    it("allows re-acquiring after release", () => {
      const h1 = acquireLock(lockDir, "/file.ts", "alice");
      releaseLock(h1);

      const h2 = acquireLock(lockDir, "/file.ts", "bob");
      expect(h2.info.owner).toBe("bob");
    });
  });

  describe("isLocked", () => {
    it("returns true when resource is locked", () => {
      acquireLock(lockDir, "/src/app.ts");
      expect(isLocked(lockDir, "/src/app.ts")).toBe(true);
    });

    it("returns false when resource is not locked", () => {
      expect(isLocked(lockDir, "/src/app.ts")).toBe(false);
    });

    it("returns false after lock is released", () => {
      const handle = acquireLock(lockDir, "/src/app.ts");
      releaseLock(handle);
      expect(isLocked(lockDir, "/src/app.ts")).toBe(false);
    });
  });

  describe("concurrent safety", () => {
    it("different resources can be locked independently", () => {
      const h1 = acquireLock(lockDir, "/file-a.ts", "alice");
      const h2 = acquireLock(lockDir, "/file-b.ts", "bob");

      expect(isLocked(lockDir, "/file-a.ts")).toBe(true);
      expect(isLocked(lockDir, "/file-b.ts")).toBe(true);

      releaseLock(h1);
      expect(isLocked(lockDir, "/file-a.ts")).toBe(false);
      expect(isLocked(lockDir, "/file-b.ts")).toBe(true);

      releaseLock(h2);
    });

    it("uses deterministic hash so same resource always maps to same lock file", () => {
      const h1 = acquireLock(lockDir, "/same/path.ts");
      const path1 = h1.lockPath;
      releaseLock(h1);

      const h2 = acquireLock(lockDir, "/same/path.ts");
      expect(h2.lockPath).toBe(path1);
      releaseLock(h2);
    });

    it("atomic write does not leave .tmp files on success", () => {
      const handle = acquireLock(lockDir, "/atomic.ts");
      const tmpPath = handle.lockPath + ".tmp";
      expect(existsSync(tmpPath)).toBe(false);
      releaseLock(handle);
    });
  });
});
