import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSessionManager } from "../src/session-manager.js";
import type { SessionManager, TranscriptEvent } from "../src/session-manager.js";

describe("createSessionManager", () => {
  let tempDir: string;
  let projectsDir: string;
  let sm: SessionManager;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-sm-test-"));
    projectsDir = join(tempDir, "projects");
    sm = createSessionManager(projectsDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("create", () => {
    it("creates a session with default title", () => {
      const session = sm.create();
      expect(session.id).toBeDefined();
      expect(session.title).toBe("");
      expect(session.starred).toBe(false);
      expect(session.createdAt).toBeDefined();
      expect(session.updatedAt).toBeDefined();
    });

    it("creates a session with custom title", () => {
      const session = sm.create({ title: "My Research" });
      expect(session.title).toBe("My Research");
    });

    it("creates unique sessions", () => {
      const s1 = sm.create();
      const s2 = sm.create();
      expect(s1.id).not.toBe(s2.id);
    });

    it("writes meta.json file", () => {
      const session = sm.create({ title: "Test" });
      const metaPath = join(projectsDir, `${session.id}.meta.json`);
      expect(existsSync(metaPath)).toBe(true);
      const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
      expect(meta.title).toBe("Test");
      expect(meta.id).toBe(session.id);
    });
  });

  describe("list", () => {
    it("returns empty array when no sessions", () => {
      expect(sm.list()).toEqual([]);
    });

    it("returns all sessions ordered by updatedAt DESC", async () => {
      sm.create({ title: "First" });
      // Ensure timestamp difference so ordering is deterministic
      await new Promise((r) => setTimeout(r, 10));
      sm.create({ title: "Second" });
      const all = sm.list();
      expect(all).toHaveLength(2);
      // Most recently created comes first
      expect(all[0]!.title).toBe("Second");
      expect(all[1]!.title).toBe("First");
    });
  });

  describe("get", () => {
    it("returns session with events", async () => {
      const created = sm.create({ title: "Test" });
      const event: TranscriptEvent = {
        type: "user",
        message: { role: "user", content: "Hello" },
        timestamp: new Date().toISOString(),
      };
      await sm.appendEvent(created.id, event);

      const session = await sm.get(created.id);
      expect(session).toBeDefined();
      expect(session!.title).toBe("Test");
      expect(session!.events).toHaveLength(1);
      expect(session!.events[0]!.type).toBe("user");
      expect((session!.events[0]!.message as { content: string }).content).toBe("Hello");
    });

    it("returns undefined for nonexistent session", async () => {
      expect(await sm.get("nonexistent-id")).toBeUndefined();
    });

    it("returns empty events for session with no transcript", async () => {
      const created = sm.create();
      const session = await sm.get(created.id);
      expect(session!.events).toEqual([]);
    });
  });

  describe("delete", () => {
    it("deletes session and transcript", async () => {
      const created = sm.create();
      const event: TranscriptEvent = {
        type: "user",
        message: { role: "user", content: "test" },
        timestamp: new Date().toISOString(),
      };
      await sm.appendEvent(created.id, event);

      const result = sm.delete(created.id);
      expect(result).toBe(true);
      expect(await sm.get(created.id)).toBeUndefined();

      const transcriptPath = join(projectsDir, `${created.id}.jsonl`);
      expect(existsSync(transcriptPath)).toBe(false);

      const metaPath = join(projectsDir, `${created.id}.meta.json`);
      expect(existsSync(metaPath)).toBe(false);
    });

    it("returns false for nonexistent session", () => {
      expect(sm.delete("nonexistent")).toBe(false);
    });

    it("deletes session without transcript file", () => {
      const created = sm.create();
      expect(sm.delete(created.id)).toBe(true);
    });

    it("clears busy state on delete", () => {
      const created = sm.create();
      sm.setBusy(created.id, true);
      expect(sm.isBusy(created.id)).toBe(true);
      sm.delete(created.id);
      expect(sm.isBusy(created.id)).toBe(false);
    });
  });

  describe("rename", () => {
    it("renames a session", async () => {
      const created = sm.create({ title: "Old" });
      const result = sm.rename(created.id, "New");
      expect(result).toBe(true);

      const session = await sm.get(created.id);
      expect(session!.title).toBe("New");
    });

    it("returns false for nonexistent session", () => {
      expect(sm.rename("nonexistent", "Title")).toBe(false);
    });
  });

  describe("star", () => {
    it("stars a session", async () => {
      const created = sm.create();
      expect(sm.star(created.id, true)).toBe(true);

      const session = await sm.get(created.id);
      expect(session!.starred).toBe(true);
    });

    it("unstars a session", async () => {
      const created = sm.create();
      sm.star(created.id, true);
      sm.star(created.id, false);

      const session = await sm.get(created.id);
      expect(session!.starred).toBe(false);
    });

    it("returns false for nonexistent session", () => {
      expect(sm.star("nonexistent", true)).toBe(false);
    });
  });

  describe("appendEvent", () => {
    it("appends events to JSONL file", async () => {
      const created = sm.create();
      const event1: TranscriptEvent = { type: "user", message: { role: "user", content: "Hi" }, timestamp: "2026-01-01T00:00:00Z" };
      const event2: TranscriptEvent = { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Hello!" }] }, timestamp: "2026-01-01T00:00:01Z" };

      await sm.appendEvent(created.id, event1);
      await sm.appendEvent(created.id, event2);

      const transcriptPath = join(projectsDir, `${created.id}.jsonl`);
      const lines = readFileSync(transcriptPath, "utf-8").trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]!)).toEqual(event1);
      expect(JSON.parse(lines[1]!)).toEqual(event2);
    });

    it("throws when session does not exist", async () => {
      const event: TranscriptEvent = { type: "user", message: { role: "user", content: "test" }, timestamp: new Date().toISOString() };
      await expect(sm.appendEvent("nonexistent-id", event)).rejects.toThrow("Session not found");
    });

    it("updates session updatedAt", async () => {
      const created = sm.create();
      const originalUpdatedAt = created.updatedAt;

      // Wait to ensure timestamp difference
      await new Promise((r) => setTimeout(r, 10));

      const event: TranscriptEvent = { type: "user", message: { role: "user", content: "test" }, timestamp: new Date().toISOString() };
      await sm.appendEvent(created.id, event);

      const session = await sm.get(created.id);
      expect(session!.updatedAt).not.toBe(originalUpdatedAt);
    });

    it("stores arbitrary event types", async () => {
      const created = sm.create();
      const progressEvent: TranscriptEvent = {
        type: "progress",
        data: { toolUseId: "abc", content: "Reading file..." },
        timestamp: "2026-01-01T00:00:00Z",
      };
      await sm.appendEvent(created.id, progressEvent);

      const session = await sm.get(created.id);
      expect(session!.events[0]!.type).toBe("progress");
      expect((session!.events[0]!.data as { toolUseId: string }).toolUseId).toBe("abc");
    });
  });

  describe("busy detection", () => {
    it("sessions start as not busy", () => {
      const created = sm.create();
      expect(sm.isBusy(created.id)).toBe(false);
    });

    it("can mark session as busy", () => {
      const created = sm.create();
      sm.setBusy(created.id, true);
      expect(sm.isBusy(created.id)).toBe(true);
    });

    it("can clear busy state", () => {
      const created = sm.create();
      sm.setBusy(created.id, true);
      sm.setBusy(created.id, false);
      expect(sm.isBusy(created.id)).toBe(false);
    });
  });

  describe("transcript handling", () => {
    it("creates projects directory if not exists", () => {
      const nestedDir = join(tempDir, "deep", "nested", "projects");
      const sm2 = createSessionManager(nestedDir);
      expect(existsSync(nestedDir)).toBe(true);
      // Use sm2 to suppress unused warning
      expect(sm2.list()).toEqual([]);
    });

    it("skips malformed lines in JSONL transcript", async () => {
      const created = sm.create();
      const transcriptPath = join(projectsDir, `${created.id}.jsonl`);
      writeFileSync(transcriptPath, '{"type":"user","message":{"role":"user","content":"ok"}}\nnot-json\n{"type":"assistant","message":{"role":"assistant","content":"hi"}}\n');

      const session = await sm.get(created.id);
      expect(session!.events).toHaveLength(2);
      expect(session!.events[0]!.type).toBe("user");
      expect(session!.events[1]!.type).toBe("assistant");
    });

    it("handles empty JSONL file gracefully", async () => {
      const created = sm.create();
      const transcriptPath = join(projectsDir, `${created.id}.jsonl`);
      writeFileSync(transcriptPath, "");

      const session = await sm.get(created.id);
      expect(session!.events).toEqual([]);
    });

    it("handles corrupted meta.json gracefully", () => {
      const created = sm.create();
      const metaPath = join(projectsDir, `${created.id}.meta.json`);
      writeFileSync(metaPath, "not-valid-json");

      // list should skip corrupted entries
      const sessions = sm.list();
      expect(sessions).toHaveLength(0);
    });

    it("list skips non-meta files in projects directory", async () => {
      sm.create({ title: "Real" });
      // Write a .jsonl file and a random file — list should skip them
      writeFileSync(join(projectsDir, "random-file.jsonl"), "data");
      writeFileSync(join(projectsDir, "notes.txt"), "text");

      const sessions = sm.list();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]!.title).toBe("Real");
    });

    it("list returns empty for nonexistent directory", () => {
      const sm2 = createSessionManager(join(tempDir, "nonexistent"));
      // Remove the directory that was auto-created
      rmSync(join(tempDir, "nonexistent"), { recursive: true, force: true });
      expect(sm2.list()).toEqual([]);
    });

    it("sort uses secondary id sort when updatedAt is equal", () => {
      // Create two sessions with identical timestamps by writing meta directly
      const id1 = "aaaa-session";
      const id2 = "zzzz-session";
      const now = "2026-01-01T00:00:00.000Z";
      writeFileSync(join(projectsDir, `${id1}.meta.json`), JSON.stringify({ id: id1, title: "A", starred: false, createdAt: now, updatedAt: now }));
      writeFileSync(join(projectsDir, `${id2}.meta.json`), JSON.stringify({ id: id2, title: "Z", starred: false, createdAt: now, updatedAt: now }));

      const sessions = sm.list();
      expect(sessions).toHaveLength(2);
      // zzzz comes first (DESC by id)
      expect(sessions[0]!.id).toBe(id2);
      expect(sessions[1]!.id).toBe(id1);
    });
  });
});
