import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSyncBundle, applySyncBundle, syncToNode } from "../src/git-sync.js";
import type { SyncBundle } from "../src/git-sync.js";

describe("git-sync", () => {
  let srcDir: string;
  let dstDir: string;

  beforeEach(() => {
    srcDir = mkdtempSync(join(tmpdir(), "sync-src-"));
    dstDir = mkdtempSync(join(tmpdir(), "sync-dst-"));
  });

  afterEach(() => {
    rmSync(srcDir, { recursive: true, force: true });
    rmSync(dstDir, { recursive: true, force: true });
  });

  describe("createSyncBundle", () => {
    it("bundles all files from a directory", () => {
      writeFileSync(join(srcDir, "hello.txt"), "hello world");
      writeFileSync(join(srcDir, "config.json"), '{"key":"value"}');

      const bundle = createSyncBundle(srcDir);

      expect(Object.keys(bundle.files)).toHaveLength(2);
      expect(Buffer.from(bundle.files["hello.txt"]!, "base64").toString()).toBe("hello world");
      expect(Buffer.from(bundle.files["config.json"]!, "base64").toString()).toBe('{"key":"value"}');
    });

    it("includes files in subdirectories", () => {
      mkdirSync(join(srcDir, "sub", "deep"), { recursive: true });
      writeFileSync(join(srcDir, "root.txt"), "root");
      writeFileSync(join(srcDir, "sub", "nested.txt"), "nested");
      writeFileSync(join(srcDir, "sub", "deep", "deep.txt"), "deep");

      const bundle = createSyncBundle(srcDir);

      expect(Object.keys(bundle.files).sort()).toEqual([
        "root.txt",
        "sub/deep/deep.txt",
        "sub/nested.txt",
      ]);
    });

    it("skips hidden directories except .claude", () => {
      mkdirSync(join(srcDir, ".git"));
      mkdirSync(join(srcDir, ".hidden"));
      mkdirSync(join(srcDir, ".claude"));
      writeFileSync(join(srcDir, ".git", "HEAD"), "ref: refs/heads/main");
      writeFileSync(join(srcDir, ".hidden", "secret"), "s");
      writeFileSync(join(srcDir, ".claude", "settings.json"), "{}");

      const bundle = createSyncBundle(srcDir);

      const keys = Object.keys(bundle.files);
      expect(keys).toContain(".claude/settings.json");
      expect(keys).not.toContain(".git/HEAD");
      expect(keys).not.toContain(".hidden/secret");
    });

    it("skips node_modules", () => {
      mkdirSync(join(srcDir, "node_modules", "dep"), { recursive: true });
      writeFileSync(join(srcDir, "node_modules", "dep", "index.js"), "module.exports = {}");
      writeFileSync(join(srcDir, "app.js"), "console.log('hi')");

      const bundle = createSyncBundle(srcDir);

      expect(Object.keys(bundle.files)).toEqual(["app.js"]);
    });

    it("returns empty bundle for empty directory", () => {
      const bundle = createSyncBundle(srcDir);
      expect(Object.keys(bundle.files)).toHaveLength(0);
    });

    it("handles binary files via base64 encoding", () => {
      const binaryContent = Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x42]);
      writeFileSync(join(srcDir, "binary.bin"), binaryContent);

      const bundle = createSyncBundle(srcDir);
      const decoded = Buffer.from(bundle.files["binary.bin"]!, "base64");

      expect(decoded).toEqual(binaryContent);
    });
  });

  describe("applySyncBundle", () => {
    it("writes all files from a bundle to the target directory", () => {
      const bundle: SyncBundle = {
        files: {
          "hello.txt": Buffer.from("hello world").toString("base64"),
          "config.json": Buffer.from('{"key":"value"}').toString("base64"),
        },
      };

      const written = applySyncBundle(dstDir, bundle);

      expect(written.sort()).toEqual(["config.json", "hello.txt"]);
      expect(readFileSync(join(dstDir, "hello.txt"), "utf-8")).toBe("hello world");
      expect(readFileSync(join(dstDir, "config.json"), "utf-8")).toBe('{"key":"value"}');
    });

    it("creates subdirectories as needed", () => {
      const bundle: SyncBundle = {
        files: {
          "sub/deep/file.txt": Buffer.from("nested").toString("base64"),
        },
      };

      const written = applySyncBundle(dstDir, bundle);

      expect(written).toEqual(["sub/deep/file.txt"]);
      expect(readFileSync(join(dstDir, "sub", "deep", "file.txt"), "utf-8")).toBe("nested");
    });

    it("overwrites existing files", () => {
      writeFileSync(join(dstDir, "existing.txt"), "old content");

      const bundle: SyncBundle = {
        files: {
          "existing.txt": Buffer.from("new content").toString("base64"),
        },
      };

      applySyncBundle(dstDir, bundle);

      expect(readFileSync(join(dstDir, "existing.txt"), "utf-8")).toBe("new content");
    });

    it("returns empty array for empty bundle", () => {
      const bundle: SyncBundle = { files: {} };
      const written = applySyncBundle(dstDir, bundle);
      expect(written).toEqual([]);
    });
  });

  describe("round-trip", () => {
    it("preserves file contents through bundle → apply cycle", () => {
      writeFileSync(join(srcDir, "text.txt"), "hello");
      mkdirSync(join(srcDir, "sub"));
      writeFileSync(join(srcDir, "sub", "data.json"), '{"a":1}');
      const binary = Buffer.from([0x00, 0x42, 0xff]);
      writeFileSync(join(srcDir, "binary.bin"), binary);

      const bundle = createSyncBundle(srcDir);
      applySyncBundle(dstDir, bundle);

      expect(readFileSync(join(dstDir, "text.txt"), "utf-8")).toBe("hello");
      expect(readFileSync(join(dstDir, "sub", "data.json"), "utf-8")).toBe('{"a":1}');
      expect(readFileSync(join(dstDir, "binary.bin"))).toEqual(binary);
    });
  });

  describe("syncToNode", () => {
    it("creates bundle from localDir and calls fetchFn", async () => {
      writeFileSync(join(srcDir, "a.txt"), "aaa");
      writeFileSync(join(srcDir, "b.txt"), "bbb");

      const fetchFn = vi.fn().mockResolvedValue({ status: 200 });

      const result = await syncToNode({
        localDir: srcDir,
        remotePath: "/workspace/project",
        fetchFn,
      });

      expect(result.filesCount).toBe(2);
      expect(result.status).toBe(200);
      expect(fetchFn).toHaveBeenCalledTimes(1);

      const callArg = fetchFn.mock.calls[0]![0];
      expect(callArg.remotePath).toBe("/workspace/project");
      expect(Object.keys(callArg.bundle.files)).toHaveLength(2);
    });

    it("returns status from fetchFn", async () => {
      writeFileSync(join(srcDir, "x.txt"), "x");
      const fetchFn = vi.fn().mockResolvedValue({ status: 500 });

      const result = await syncToNode({
        localDir: srcDir,
        remotePath: "/remote",
        fetchFn,
      });

      expect(result.status).toBe(500);
      expect(result.filesCount).toBe(1);
    });

    it("propagates fetchFn errors", async () => {
      writeFileSync(join(srcDir, "x.txt"), "x");
      const fetchFn = vi.fn().mockRejectedValue(new Error("network error"));

      await expect(syncToNode({
        localDir: srcDir,
        remotePath: "/remote",
        fetchFn,
      })).rejects.toThrow("network error");
    });
  });
});
