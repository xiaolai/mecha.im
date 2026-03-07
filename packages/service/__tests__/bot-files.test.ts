import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveBotHome,
  listBotDir,
  readBotFile,
  writeBotFile,
  FileNotFoundError,
  NotMarkdownError,
  FileTooLargeError,
} from "../src/bot-files.js";
import { PathTraversalError } from "@mecha/core";

describe("resolveBotHome", () => {
  it("uses configHome when provided", () => {
    expect(resolveBotHome("/mecha", "alice", "/custom/home")).toBe("/custom/home");
  });

  it("falls back to mechaDir/botName", () => {
    expect(resolveBotHome("/mecha", "alice")).toBe(join("/mecha", "alice"));
  });
});

describe("listBotDir", () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), "bot-files-"));
    writeFileSync(join(homeDir, "readme.md"), "# Hello");
    writeFileSync(join(homeDir, "notes.txt"), "some notes");
    mkdirSync(join(homeDir, "docs"));
    writeFileSync(join(homeDir, "docs", "guide.md"), "# Guide");
    writeFileSync(join(homeDir, ".secret"), "hidden");
  });

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
  });

  it("lists root directory entries, directories first", async () => {
    const entries = await listBotDir(homeDir, "");
    const names = entries.map((e) => e.name);
    expect(names).toEqual(["docs", "notes.txt", "readme.md"]);
    expect(entries[0].type).toBe("directory");
    expect(entries[1].type).toBe("file");
  });

  it("lists subdirectory entries", async () => {
    const entries = await listBotDir(homeDir, "docs");
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("guide.md");
  });

  it("excludes hidden files", async () => {
    const entries = await listBotDir(homeDir, "");
    const names = entries.map((e) => e.name);
    expect(names).not.toContain(".secret");
  });

  it("skips symlinks", async () => {
    symlinkSync("/tmp", join(homeDir, "link-dir"));
    const entries = await listBotDir(homeDir, "");
    const names = entries.map((e) => e.name);
    expect(names).not.toContain("link-dir");
  });

  it("returns empty array for non-existent directory", async () => {
    const entries = await listBotDir(homeDir, "nope");
    expect(entries).toEqual([]);
  });

  it("returns empty array when path is a file (ENOTDIR)", async () => {
    const entries = await listBotDir(homeDir, "readme.md");
    expect(entries).toEqual([]);
  });

  it("rejects path traversal", async () => {
    await expect(listBotDir(homeDir, "../")).rejects.toThrow(PathTraversalError);
  });

  it("includes size and modifiedAt", async () => {
    const entries = await listBotDir(homeDir, "");
    const readme = entries.find((e) => e.name === "readme.md");
    expect(readme).toBeDefined();
    expect(readme!.size).toBeGreaterThan(0);
    expect(readme!.modifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("readBotFile", () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), "bot-files-"));
    writeFileSync(join(homeDir, "readme.md"), "# Hello World");
    writeFileSync(join(homeDir, "data.json"), "{}");
  });

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
  });

  it("reads a markdown file", async () => {
    const content = await readBotFile(homeDir, "readme.md");
    expect(content).toBe("# Hello World");
  });

  it("rejects non-markdown files with NotMarkdownError", async () => {
    await expect(readBotFile(homeDir, "data.json")).rejects.toThrow(NotMarkdownError);
  });

  it("throws FileNotFoundError for missing file", async () => {
    await expect(readBotFile(homeDir, "missing.md")).rejects.toThrow(FileNotFoundError);
  });

  it("rejects empty path", async () => {
    await expect(readBotFile(homeDir, "")).rejects.toThrow("File path is required");
  });

  it("rejects path traversal", async () => {
    await expect(readBotFile(homeDir, "../etc/passwd.md")).rejects.toThrow(PathTraversalError);
  });

  it("rejects hidden path segments", async () => {
    mkdirSync(join(homeDir, ".hidden"));
    writeFileSync(join(homeDir, ".hidden", "notes.md"), "secret");
    await expect(readBotFile(homeDir, ".hidden/notes.md")).rejects.toThrow(PathTraversalError);
  });

  it("rejects symlinks to files", async () => {
    writeFileSync(join(homeDir, "real.md"), "real content");
    symlinkSync(join(homeDir, "real.md"), join(homeDir, "link.md"));
    await expect(readBotFile(homeDir, "link.md")).rejects.toThrow(FileNotFoundError);
  });

  it("rejects oversized files with FileTooLargeError", async () => {
    // Create a file > 5 MB
    const big = Buffer.alloc(6 * 1024 * 1024, "x");
    writeFileSync(join(homeDir, "big.md"), big);
    await expect(readBotFile(homeDir, "big.md")).rejects.toThrow(FileTooLargeError);
  });
});

describe("writeBotFile", () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), "bot-files-"));
  });

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
  });

  it("creates a new markdown file", async () => {
    await writeBotFile(homeDir, "new.md", "# New File");
    const content = await readBotFile(homeDir, "new.md");
    expect(content).toBe("# New File");
  });

  it("overwrites an existing markdown file", async () => {
    writeFileSync(join(homeDir, "existing.md"), "old");
    await writeBotFile(homeDir, "existing.md", "updated");
    const content = await readBotFile(homeDir, "existing.md");
    expect(content).toBe("updated");
  });

  it("creates parent directories as needed", async () => {
    await writeBotFile(homeDir, "a/b/deep.md", "# Deep");
    const content = await readBotFile(homeDir, "a/b/deep.md");
    expect(content).toBe("# Deep");
  });

  it("rejects non-markdown files with NotMarkdownError", async () => {
    await expect(writeBotFile(homeDir, "hack.sh", "#!/bin/bash")).rejects.toThrow(NotMarkdownError);
  });

  it("rejects empty path", async () => {
    await expect(writeBotFile(homeDir, "", "content")).rejects.toThrow("File path is required");
  });

  it("rejects path traversal", async () => {
    await expect(writeBotFile(homeDir, "../escape.md", "bad")).rejects.toThrow(PathTraversalError);
  });

  it("rejects hidden path segments", async () => {
    await expect(writeBotFile(homeDir, ".hidden/secret.md", "bad")).rejects.toThrow(PathTraversalError);
  });

  it("rejects oversized content", async () => {
    const huge = "x".repeat(6 * 1024 * 1024); // 6 MB
    await expect(writeBotFile(homeDir, "big.md", huge)).rejects.toThrow(/too large/i);
  });
});
