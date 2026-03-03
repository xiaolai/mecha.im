import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSessionManager } from "../src/session-manager.js";
import type { SessionManager } from "../src/session-manager.js";

/**
 * Helper: write a session's meta.json (simulating what Claude Code writes).
 */
function writeMeta(dir: string, id: string, opts: { title?: string; starred?: boolean; createdAt?: string; updatedAt?: string } = {}): void {
  const meta = {
    id,
    title: opts.title ?? "",
    starred: opts.starred ?? false,
    createdAt: opts.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: opts.updatedAt ?? opts.createdAt ?? "2026-01-01T00:00:00.000Z",
  };
  writeFileSync(join(dir, `${id}.meta.json`), JSON.stringify(meta, null, 2) + "\n");
}

/**
 * Helper: write a session's JSONL transcript (simulating what Claude Code writes).
 */
function writeTranscript(dir: string, id: string, events: Array<{ type: string; [k: string]: unknown }>): void {
  const content = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  writeFileSync(join(dir, `${id}.jsonl`), content);
}

describe("createSessionManager", () => {
  let tempDir: string;
  let projectsDir: string;
  let sm: SessionManager;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-sm-test-"));
    projectsDir = join(tempDir, "projects");
    mkdirSync(projectsDir, { recursive: true });
    sm = createSessionManager(projectsDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("list", () => {
    it("returns empty array when no sessions", () => {
      expect(sm.list()).toEqual([]);
    });

    it("returns sessions ordered by updatedAt DESC", () => {
      writeMeta(projectsDir, "sess-1", { title: "First", updatedAt: "2026-01-01T00:00:00.000Z" });
      writeMeta(projectsDir, "sess-2", { title: "Second", updatedAt: "2026-01-01T00:01:00.000Z" });

      const all = sm.list();
      expect(all).toHaveLength(2);
      expect(all[0]!.title).toBe("Second");
      expect(all[1]!.title).toBe("First");
    });

    it("uses secondary id sort when updatedAt is equal", () => {
      const now = "2026-01-01T00:00:00.000Z";
      writeMeta(projectsDir, "aaaa-session", { title: "A", updatedAt: now });
      writeMeta(projectsDir, "zzzz-session", { title: "Z", updatedAt: now });

      const sessions = sm.list();
      expect(sessions).toHaveLength(2);
      expect(sessions[0]!.id).toBe("zzzz-session");
      expect(sessions[1]!.id).toBe("aaaa-session");
    });

    it("skips non-meta files", () => {
      writeMeta(projectsDir, "real-session", { title: "Real" });
      writeFileSync(join(projectsDir, "notes.txt"), "text");

      const sessions = sm.list();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]!.title).toBe("Real");
    });

    it("skips corrupted meta.json", () => {
      writeMeta(projectsDir, "good", { title: "Good" });
      writeFileSync(join(projectsDir, "bad.meta.json"), "not-valid-json{{{");

      const sessions = sm.list();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]!.title).toBe("Good");
    });

    it("returns empty for nonexistent directory", () => {
      const sm2 = createSessionManager(join(tempDir, "nonexistent"));
      expect(sm2.list()).toEqual([]);
    });

    it("includes .jsonl-only sessions without .meta.json", () => {
      writeMeta(projectsDir, "has-meta", { title: "Has Meta", updatedAt: "2026-01-01T00:00:00.000Z" });
      // Create a .jsonl file without a corresponding .meta.json (active session)
      writeTranscript(projectsDir, "no-meta-session", [
        { type: "user", message: "hello" },
      ]);

      const sessions = sm.list();
      expect(sessions).toHaveLength(2);
      // The .jsonl-only session should have synthesized metadata
      const orphan = sessions.find((s) => s.id === "no-meta-session");
      expect(orphan).toBeDefined();
      expect(orphan!.title).toBe("(active session)");
      expect(orphan!.starred).toBe(false);
    });

    it("does not duplicate sessions that have both .meta.json and .jsonl", () => {
      writeMeta(projectsDir, "full-session", { title: "Full" });
      writeTranscript(projectsDir, "full-session", [{ type: "user", message: "hi" }]);

      const sessions = sm.list();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]!.title).toBe("Full");
    });

    it("skips .jsonl files with invalid IDs", () => {
      writeFileSync(join(projectsDir, "../../../bad.jsonl"), "data");
      // Only valid IDs pass the filter
      const sessions = sm.list();
      expect(sessions).toEqual([]);
    });
  });

  describe("get", () => {
    it("returns session with transcript events", async () => {
      writeMeta(projectsDir, "sess-1", { title: "TCP Research" });
      writeTranscript(projectsDir, "sess-1", [
        { type: "user", message: { role: "user", content: "What is TCP?" } },
        { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "TCP is..." }] } },
      ]);

      const session = await sm.get("sess-1");
      expect(session).toBeDefined();
      expect(session!.title).toBe("TCP Research");
      expect(session!.events).toHaveLength(2);
      expect(session!.events[0]!.type).toBe("user");
      expect(session!.events[1]!.type).toBe("assistant");
    });

    it("returns undefined for nonexistent session", async () => {
      expect(await sm.get("nonexistent")).toBeUndefined();
    });

    it("returns empty events when no transcript file", async () => {
      writeMeta(projectsDir, "no-transcript", { title: "New" });

      const session = await sm.get("no-transcript");
      expect(session!.events).toEqual([]);
    });

    it("returns empty events for empty transcript file", async () => {
      writeMeta(projectsDir, "empty-transcript", { title: "Empty" });
      writeFileSync(join(projectsDir, "empty-transcript.jsonl"), "");

      const session = await sm.get("empty-transcript");
      expect(session!.events).toEqual([]);
    });

    it("skips malformed lines in transcript", async () => {
      writeMeta(projectsDir, "messy", { title: "Messy" });
      writeFileSync(
        join(projectsDir, "messy.jsonl"),
        '{"type":"user","content":"ok"}\nnot-json\n{"type":"assistant","content":"hi"}\n',
      );

      const session = await sm.get("messy");
      expect(session!.events).toHaveLength(2);
      expect(session!.events[0]!.type).toBe("user");
      expect(session!.events[1]!.type).toBe("assistant");
    });

    it("returns undefined for corrupted meta.json", async () => {
      writeFileSync(join(projectsDir, "corrupt.meta.json"), "not-json");
      expect(await sm.get("corrupt")).toBeUndefined();
    });

    it("returns synthesized metadata for .jsonl-only session", async () => {
      writeTranscript(projectsDir, "jsonl-only-get", [
        { type: "user", message: "hello" },
      ]);

      const session = await sm.get("jsonl-only-get");
      expect(session).toBeDefined();
      expect(session!.title).toBe("(active session)");
      expect(session!.starred).toBe(false);
      expect(session!.events).toHaveLength(1);
    });

    it("returns undefined for meta.json with invalid field types", async () => {
      writeFileSync(
        join(projectsDir, "bad-types.meta.json"),
        JSON.stringify({ id: 123, title: null, createdAt: true, updatedAt: 0 }),
      );
      expect(await sm.get("bad-types")).toBeUndefined();
    });

    it("returns empty events when transcript exceeds 10 MB", async () => {
      writeMeta(projectsDir, "huge", { title: "Huge" });
      // Create a file just over the 10 MB limit
      const buf = Buffer.alloc(10 * 1024 * 1024 + 1, "x");
      writeFileSync(join(projectsDir, "huge.jsonl"), buf);

      const session = await sm.get("huge");
      expect(session).toBeDefined();
      expect(session!.events).toEqual([]);
    });
  });

  describe("delete", () => {
    it("deletes both .meta.json and .jsonl files", () => {
      writeMeta(projectsDir, "to-delete", { title: "Delete Me" });
      writeTranscript(projectsDir, "to-delete", [{ type: "user", message: "bye" }]);

      const result = sm.delete("to-delete");
      expect(result).toBe(true);
      expect(existsSync(join(projectsDir, "to-delete.meta.json"))).toBe(false);
      expect(existsSync(join(projectsDir, "to-delete.jsonl"))).toBe(false);
    });

    it("returns true when only .meta.json exists", () => {
      writeMeta(projectsDir, "meta-only", { title: "Meta Only" });
      expect(sm.delete("meta-only")).toBe(true);
      expect(existsSync(join(projectsDir, "meta-only.meta.json"))).toBe(false);
    });

    it("returns true when only .jsonl exists", () => {
      writeTranscript(projectsDir, "jsonl-only", [{ type: "user", message: "hi" }]);
      expect(sm.delete("jsonl-only")).toBe(true);
      expect(existsSync(join(projectsDir, "jsonl-only.jsonl"))).toBe(false);
    });

    it("returns false for nonexistent session", () => {
      expect(sm.delete("nonexistent")).toBe(false);
    });

    it("returns false for invalid session ID", () => {
      expect(sm.delete("../../../etc/passwd")).toBe(false);
    });

    it("session is no longer listed after deletion", () => {
      writeMeta(projectsDir, "doomed", { title: "Doomed" });
      writeTranscript(projectsDir, "doomed", [{ type: "user", message: "gone" }]);

      expect(sm.list()).toHaveLength(1);
      sm.delete("doomed");
      expect(sm.list()).toHaveLength(0);
    });
  });
});
