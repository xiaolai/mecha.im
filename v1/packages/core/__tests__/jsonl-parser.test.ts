import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveProjectsDir,
  listProjectSlugs,
  listSessionFiles,
  parseSessionSummary,
  parseSessionFile,
} from "../src/jsonl-parser.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function userLine(uuid: string, text: string, ts: string, parentUuid: string | null = null): string {
  return JSON.stringify({
    type: "user",
    uuid,
    parentUuid,
    sessionId: "sess-1",
    timestamp: ts,
    message: { role: "user", content: [{ type: "text", text }] },
  });
}

function assistantLine(
  uuid: string,
  text: string,
  ts: string,
  parentUuid: string | null = null,
  opts: { model?: string; thinking?: string; toolUse?: boolean; usage?: boolean } = {},
): string {
  const content: unknown[] = [];
  if (opts.thinking) content.push({ type: "thinking", thinking: opts.thinking });
  content.push({ type: "text", text });
  if (opts.toolUse) content.push({ type: "tool_use", id: "toolu_1", name: "Read", input: { file: "foo.ts" } });
  const message: Record<string, unknown> = {
    role: "assistant",
    content,
  };
  if (opts.model) message.model = opts.model;
  if (opts.usage) {
    message.usage = {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 200,
      cache_read_input_tokens: 300,
    };
  }
  return JSON.stringify({
    type: "assistant",
    uuid,
    parentUuid,
    sessionId: "sess-1",
    timestamp: ts,
    message,
  });
}

function progressLine(): string {
  return JSON.stringify({ type: "progress", data: { type: "bash_progress" }, toolUseID: "toolu_1" });
}

function systemLine(): string {
  return JSON.stringify({ type: "system", subtype: "compact_boundary", content: "compacted" });
}

function queueLine(): string {
  return JSON.stringify({ type: "queue-operation", operation: "enqueue", timestamp: "2026-01-01T00:00:00Z", sessionId: "sess-1" });
}

function fileSnapshotLine(): string {
  return JSON.stringify({ type: "file-history-snapshot", messageId: "msg-1", snapshot: {} });
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "jsonl-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// resolveProjectsDir
// ---------------------------------------------------------------------------

describe("resolveProjectsDir", () => {
  it("returns the .claude/projects path under the given mecha path", () => {
    expect(resolveProjectsDir("/home/mecha")).toBe("/home/mecha/.claude/projects");
  });

  it("handles trailing slash in mecha path", () => {
    expect(resolveProjectsDir("/home/mecha/")).toBe("/home/mecha/.claude/projects");
  });
});

// ---------------------------------------------------------------------------
// listProjectSlugs
// ---------------------------------------------------------------------------

describe("listProjectSlugs", () => {
  it("returns empty array when directory does not exist", () => {
    expect(listProjectSlugs(join(tmpDir, "nonexistent"))).toEqual([]);
  });

  it("lists only directories, sorted alphabetically", () => {
    const projectsDir = join(tmpDir, "projects");
    mkdirSync(projectsDir);
    mkdirSync(join(projectsDir, "-home-mecha-b"));
    mkdirSync(join(projectsDir, "-home-mecha-a"));
    writeFileSync(join(projectsDir, "not-a-dir.txt"), "hi");

    const slugs = listProjectSlugs(projectsDir);
    expect(slugs).toEqual(["-home-mecha-a", "-home-mecha-b"]);
  });

  it("returns empty array for empty directory", () => {
    const projectsDir = join(tmpDir, "empty-projects");
    mkdirSync(projectsDir);
    expect(listProjectSlugs(projectsDir)).toEqual([]);
  });

  it("skips entries where statSync fails (e.g. broken symlinks)", () => {
    const projectsDir = join(tmpDir, "projects");
    mkdirSync(projectsDir);
    mkdirSync(join(projectsDir, "good-slug"));
    // Create a symlink to a nonexistent target to trigger statSync failure
    symlinkSync("/nonexistent-target-xyz", join(projectsDir, "broken-link"));

    const slugs = listProjectSlugs(projectsDir);
    expect(slugs).toEqual(["good-slug"]);
  });
});

// ---------------------------------------------------------------------------
// listSessionFiles
// ---------------------------------------------------------------------------

describe("listSessionFiles", () => {
  it("returns empty array when no project slugs exist", () => {
    const projectsDir = join(tmpDir, "no-projects");
    mkdirSync(projectsDir);
    expect(listSessionFiles(projectsDir)).toEqual([]);
  });

  it("discovers JSONL files across multiple project slugs", () => {
    const projectsDir = join(tmpDir, "projects");
    mkdirSync(projectsDir);
    const slugA = join(projectsDir, "-home-mecha");
    const slugB = join(projectsDir, "-home-mecha-subdir");
    mkdirSync(slugA);
    mkdirSync(slugB);

    writeFileSync(join(slugA, "aaa.jsonl"), userLine("u1", "hi", "2026-01-01T00:00:00Z"));
    writeFileSync(join(slugB, "bbb.jsonl"), userLine("u2", "hello", "2026-01-02T00:00:00Z"));
    // Non-jsonl files should be ignored
    writeFileSync(join(slugA, "notes.txt"), "not a session");
    // Directories ending in .jsonl should be ignored
    mkdirSync(join(slugA, "fake.jsonl"));

    const files = listSessionFiles(projectsDir);
    expect(files).toHaveLength(2);
    expect(files.map((f) => f.sessionId)).toContain("aaa");
    expect(files.map((f) => f.sessionId)).toContain("bbb");
    expect(files[0].projectSlug).toBeDefined();
  });

  it("sorts by mtime descending (most recent first)", () => {
    const projectsDir = join(tmpDir, "projects");
    mkdirSync(projectsDir);
    const slug = join(projectsDir, "-home-mecha");
    mkdirSync(slug);

    writeFileSync(join(slug, "old.jsonl"), "{}");
    // Set old file to 2020
    utimesSync(join(slug, "old.jsonl"), new Date("2020-01-01"), new Date("2020-01-01"));

    writeFileSync(join(slug, "new.jsonl"), "{}");
    // new file keeps current mtime

    const files = listSessionFiles(projectsDir);
    expect(files[0].sessionId).toBe("new");
    expect(files[1].sessionId).toBe("old");
  });

  it("skips slug directories that cannot be read", () => {
    const projectsDir = join(tmpDir, "projects");
    mkdirSync(projectsDir);
    const goodSlug = join(projectsDir, "-good");
    mkdirSync(goodSlug);
    writeFileSync(join(goodSlug, "s1.jsonl"), userLine("u1", "hi", "2026-01-01T00:00:00Z"));
    // Create a broken symlink as a "slug" — listProjectSlugs won't include it,
    // but we can test the readdirSync catch by making a slug dir unreadable
    const badSlug = join(projectsDir, "-bad");
    mkdirSync(badSlug, { mode: 0o000 });

    const files = listSessionFiles(projectsDir);
    // Should still find files from the good slug
    expect(files.some((f) => f.sessionId === "s1")).toBe(true);
    // Restore permissions for cleanup
    const { chmodSync } = require("node:fs");
    chmodSync(badSlug, 0o755);
  });

  it("skips JSONL entries where statSync fails (e.g. broken symlink)", () => {
    const projectsDir = join(tmpDir, "projects");
    mkdirSync(projectsDir);
    const slug = join(projectsDir, "-slug");
    mkdirSync(slug);
    writeFileSync(join(slug, "good.jsonl"), userLine("u1", "hi", "2026-01-01T00:00:00Z"));
    // Create a broken symlink with .jsonl extension
    symlinkSync("/nonexistent-jsonl-target", join(slug, "broken.jsonl"));

    const files = listSessionFiles(projectsDir);
    expect(files).toHaveLength(1);
    expect(files[0].sessionId).toBe("good");
  });

  it("returns empty when projectsDir does not exist", () => {
    expect(listSessionFiles(join(tmpDir, "does-not-exist"))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseSessionSummary
// ---------------------------------------------------------------------------

describe("parseSessionSummary", () => {
  it("extracts title from first user message", () => {
    const projectsDir = join(tmpDir, "projects");
    const slug = join(projectsDir, "-home-mecha");
    mkdirSync(slug, { recursive: true });

    const file = join(slug, "abc-123.jsonl");
    writeFileSync(
      file,
      [
        userLine("u1", "Say hello, just one word", "2026-01-01T10:00:00Z"),
        assistantLine("a1", "Hello!", "2026-01-01T10:00:01Z", "u1", { model: "claude-sonnet-4-6" }),
        userLine("u2", "Thanks", "2026-01-01T10:00:02Z", "a1"),
      ].join("\n"),
    );

    const summary = parseSessionSummary(file);
    expect(summary.id).toBe("abc-123");
    expect(summary.projectSlug).toBe("-home-mecha");
    expect(summary.title).toBe("Say hello, just one word");
    expect(summary.messageCount).toBe(3);
    expect(summary.model).toBe("claude-sonnet-4-6");
    expect(summary.createdAt).toEqual(new Date("2026-01-01T10:00:00Z"));
    expect(summary.updatedAt).toEqual(new Date("2026-01-01T10:00:02Z"));
  });

  it("truncates long titles with ellipsis", () => {
    const slug = join(tmpDir, "-slug");
    mkdirSync(slug, { recursive: true });
    const file = join(slug, "long.jsonl");

    const longText = "A".repeat(200);
    writeFileSync(file, userLine("u1", longText, "2026-01-01T00:00:00Z"));

    const summary = parseSessionSummary(file);
    expect(summary.title.length).toBeLessThanOrEqual(120);
    expect(summary.title.endsWith("\u2026")).toBe(true);
  });

  it("skips progress, system, queue-operation, and file-history-snapshot lines", () => {
    const slug = join(tmpDir, "-slug");
    mkdirSync(slug, { recursive: true });
    const file = join(slug, "mixed.jsonl");
    writeFileSync(
      file,
      [
        progressLine(),
        systemLine(),
        queueLine(),
        fileSnapshotLine(),
        userLine("u1", "Hello", "2026-01-01T00:00:00Z"),
        progressLine(),
        assistantLine("a1", "Hi", "2026-01-01T00:00:01Z", "u1"),
      ].join("\n"),
    );

    const summary = parseSessionSummary(file);
    expect(summary.messageCount).toBe(2);
    expect(summary.title).toBe("Hello");
  });

  it("returns (untitled) for empty file", () => {
    const slug = join(tmpDir, "-slug");
    mkdirSync(slug, { recursive: true });
    const file = join(slug, "empty.jsonl");
    writeFileSync(file, "");

    const summary = parseSessionSummary(file);
    expect(summary.title).toBe("(untitled)");
    expect(summary.messageCount).toBe(0);
  });

  it("handles malformed JSON lines gracefully", () => {
    const slug = join(tmpDir, "-slug");
    mkdirSync(slug, { recursive: true });
    const file = join(slug, "bad.jsonl");
    writeFileSync(
      file,
      [
        "not json at all",
        "{invalid json}",
        userLine("u1", "Valid message", "2026-01-01T00:00:00Z"),
      ].join("\n"),
    );

    const summary = parseSessionSummary(file);
    expect(summary.messageCount).toBe(1);
    expect(summary.title).toBe("Valid message");
  });

  it("handles user messages with string content (not array)", () => {
    const slug = join(tmpDir, "-slug");
    mkdirSync(slug, { recursive: true });
    const file = join(slug, "string-content.jsonl");
    writeFileSync(
      file,
      JSON.stringify({
        type: "user",
        uuid: "u1",
        parentUuid: null,
        sessionId: "s1",
        timestamp: "2026-01-01T00:00:00Z",
        message: { role: "user", content: "Plain string message" },
      }),
    );

    const summary = parseSessionSummary(file);
    expect(summary.title).toBe("Plain string message");
    expect(summary.messageCount).toBe(1);
  });

  it("handles content with non-text blocks only (e.g., only tool_use)", () => {
    const slug = join(tmpDir, "-slug");
    mkdirSync(slug, { recursive: true });
    const file = join(slug, "no-text.jsonl");
    // User message with content array that has no text blocks
    writeFileSync(
      file,
      JSON.stringify({
        type: "user",
        uuid: "u1",
        parentUuid: null,
        sessionId: "s1",
        timestamp: "2026-01-01T00:00:00Z",
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "result" }] },
      }),
    );

    const summary = parseSessionSummary(file);
    // No text blocks → empty text → title is (untitled) because the first user msg had no text
    expect(summary.title).toBe("(untitled)");
  });

  it("sets createdAt from first assistant message when no user message precedes it", () => {
    const slug = join(tmpDir, "-slug");
    mkdirSync(slug, { recursive: true });
    const file = join(slug, "asst-first.jsonl");
    writeFileSync(
      file,
      [
        assistantLine("a1", "I start the conversation", "2026-06-01T12:00:00Z"),
        userLine("u1", "Hi after", "2026-06-01T12:00:01Z", "a1"),
      ].join("\n"),
    );

    const summary = parseSessionSummary(file);
    expect(summary.createdAt).toEqual(new Date("2026-06-01T12:00:00Z"));
    expect(summary.messageCount).toBe(2);
  });

  it("collapses newlines in title to spaces", () => {
    const slug = join(tmpDir, "-slug");
    mkdirSync(slug, { recursive: true });
    const file = join(slug, "newlines.jsonl");
    writeFileSync(
      file,
      userLine("u1", "line one\nline two\nline three", "2026-01-01T00:00:00Z"),
    );

    const summary = parseSessionSummary(file);
    expect(summary.title).toBe("line one line two line three");
  });
});

// ---------------------------------------------------------------------------
// parseSessionFile
// ---------------------------------------------------------------------------

describe("parseSessionFile", () => {
  it("parses user and assistant messages with all content blocks", () => {
    const slug = join(tmpDir, "-home-mecha");
    mkdirSync(slug, { recursive: true });
    const file = join(slug, "full-session.jsonl");
    writeFileSync(
      file,
      [
        userLine("u1", "Explain this code", "2026-01-01T10:00:00Z"),
        assistantLine("a1", "Here is the explanation", "2026-01-01T10:00:01Z", "u1", {
          model: "claude-sonnet-4-6",
          thinking: "Let me analyze...",
          toolUse: true,
          usage: true,
        }),
      ].join("\n"),
    );

    const session = parseSessionFile(file);
    expect(session.id).toBe("full-session");
    expect(session.projectSlug).toBe("-home-mecha");
    expect(session.messages).toHaveLength(2);
    expect(session.messageCount).toBe(2);

    // User message
    const user = session.messages[0];
    expect(user.role).toBe("user");
    expect(user.content).toEqual([{ type: "text", text: "Explain this code" }]);
    expect(user.uuid).toBe("u1");
    expect(user.parentUuid).toBeNull();

    // Assistant message
    const asst = session.messages[1];
    expect(asst.role).toBe("assistant");
    expect(asst.model).toBe("claude-sonnet-4-6");
    expect(asst.content).toHaveLength(3); // thinking + text + tool_use
    expect(asst.content[0]).toEqual({ type: "thinking", thinking: "Let me analyze..." });
    expect(asst.content[1]).toEqual({ type: "text", text: "Here is the explanation" });
    expect(asst.content[2]).toEqual({ type: "tool_use", id: "toolu_1", name: "Read", input: { file: "foo.ts" } });

    // Usage
    expect(asst.usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 300,
      cacheCreationTokens: 200,
    });
  });

  it("skips non-message entries (progress, system, etc.)", () => {
    const slug = join(tmpDir, "-slug");
    mkdirSync(slug, { recursive: true });
    const file = join(slug, "with-noise.jsonl");
    writeFileSync(
      file,
      [
        userLine("u1", "Hi", "2026-01-01T00:00:00Z"),
        progressLine(),
        systemLine(),
        queueLine(),
        fileSnapshotLine(),
        assistantLine("a1", "Hello", "2026-01-01T00:00:01Z", "u1"),
      ].join("\n"),
    );

    const session = parseSessionFile(file);
    expect(session.messages).toHaveLength(2);
  });

  it("handles empty file gracefully", () => {
    const slug = join(tmpDir, "-slug");
    mkdirSync(slug, { recursive: true });
    const file = join(slug, "empty.jsonl");
    writeFileSync(file, "");

    const session = parseSessionFile(file);
    expect(session.messages).toHaveLength(0);
    expect(session.title).toBe("(untitled)");
    expect(session.messageCount).toBe(0);
  });

  it("handles malformed lines and continues parsing", () => {
    const slug = join(tmpDir, "-slug");
    mkdirSync(slug, { recursive: true });
    const file = join(slug, "partially-bad.jsonl");
    writeFileSync(
      file,
      [
        "broken line",
        userLine("u1", "Good message", "2026-01-01T00:00:00Z"),
      ].join("\n"),
    );

    const session = parseSessionFile(file);
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0].role).toBe("user");
  });

  it("converts string content to ContentBlock array", () => {
    const slug = join(tmpDir, "-slug");
    mkdirSync(slug, { recursive: true });
    const file = join(slug, "string-content.jsonl");
    writeFileSync(
      file,
      JSON.stringify({
        type: "user",
        uuid: "u1",
        parentUuid: null,
        sessionId: "s1",
        timestamp: "2026-01-01T00:00:00Z",
        message: { role: "user", content: "Plain string" },
      }),
    );

    const session = parseSessionFile(file);
    expect(session.messages[0].content).toEqual([{ type: "text", text: "Plain string" }]);
  });

  it("handles assistant messages without model or usage", () => {
    const slug = join(tmpDir, "-slug");
    mkdirSync(slug, { recursive: true });
    const file = join(slug, "no-model.jsonl");
    writeFileSync(
      file,
      [
        userLine("u1", "Hi", "2026-01-01T00:00:00Z"),
        assistantLine("a1", "Hello", "2026-01-01T00:00:01Z", "u1"),
      ].join("\n"),
    );

    const session = parseSessionFile(file);
    const asst = session.messages[1];
    expect(asst.model).toBeUndefined();
    expect(asst.usage).toBeUndefined();
    expect(session.model).toBeUndefined();
  });

  it("sets createdAt from first assistant message when it appears first", () => {
    const slug = join(tmpDir, "-slug");
    mkdirSync(slug, { recursive: true });
    const file = join(slug, "asst-first.jsonl");
    writeFileSync(
      file,
      [
        assistantLine("a1", "Hello", "2026-03-01T08:00:00Z"),
        userLine("u1", "Hi", "2026-03-01T08:00:01Z", "a1"),
      ].join("\n"),
    );

    const session = parseSessionFile(file);
    expect(session.createdAt).toEqual(new Date("2026-03-01T08:00:00Z"));
  });

  it("preserves parentUuid chain", () => {
    const slug = join(tmpDir, "-slug");
    mkdirSync(slug, { recursive: true });
    const file = join(slug, "chain.jsonl");
    writeFileSync(
      file,
      [
        userLine("u1", "First", "2026-01-01T00:00:00Z"),
        assistantLine("a1", "Response", "2026-01-01T00:00:01Z", "u1"),
        userLine("u2", "Second", "2026-01-01T00:00:02Z", "a1"),
      ].join("\n"),
    );

    const session = parseSessionFile(file);
    expect(session.messages[0].parentUuid).toBeNull();
    expect(session.messages[1].parentUuid).toBe("u1");
    expect(session.messages[2].parentUuid).toBe("a1");
  });
});
