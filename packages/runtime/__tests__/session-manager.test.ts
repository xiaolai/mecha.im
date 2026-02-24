import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { runMigrations } from "../src/database.js";
import { createSessionManager } from "../src/session-manager.js";
import type { SessionManager, SessionMessage } from "../src/session-manager.js";

describe("createSessionManager", () => {
  let tempDir: string;
  let db: InstanceType<typeof Database>;
  let sm: SessionManager;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-sm-test-"));
    db = new Database(":memory:");
    runMigrations(db);
    sm = createSessionManager(db, join(tempDir, "transcripts"));
  });

  afterEach(() => {
    db.close();
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
  });

  describe("list", () => {
    it("returns empty array when no sessions", () => {
      expect(sm.list()).toEqual([]);
    });

    it("returns all sessions ordered by updatedAt DESC", () => {
      sm.create({ title: "First" });
      sm.create({ title: "Second" });
      const all = sm.list();
      expect(all).toHaveLength(2);
      // Most recently created comes first
      expect(all[0]!.title).toBe("Second");
      expect(all[1]!.title).toBe("First");
    });
  });

  describe("get", () => {
    it("returns session with messages", async () => {
      const created = sm.create({ title: "Test" });
      const msg: SessionMessage = {
        role: "user",
        content: "Hello",
        timestamp: new Date().toISOString(),
      };
      await sm.appendMessage(created.id, msg);

      const session = await sm.get(created.id);
      expect(session).toBeDefined();
      expect(session!.title).toBe("Test");
      expect(session!.messages).toHaveLength(1);
      expect(session!.messages[0]!.content).toBe("Hello");
    });

    it("returns undefined for nonexistent session", async () => {
      expect(await sm.get("nonexistent-id")).toBeUndefined();
    });

    it("returns empty messages for session with no transcript", async () => {
      const created = sm.create();
      const session = await sm.get(created.id);
      expect(session!.messages).toEqual([]);
    });
  });

  describe("delete", () => {
    it("deletes session and transcript", async () => {
      const created = sm.create();
      const msg: SessionMessage = {
        role: "user",
        content: "test",
        timestamp: new Date().toISOString(),
      };
      await sm.appendMessage(created.id, msg);

      const result = sm.delete(created.id);
      expect(result).toBe(true);
      expect(await sm.get(created.id)).toBeUndefined();

      const transcriptPath = join(tempDir, "transcripts", `${created.id}.jsonl`);
      expect(existsSync(transcriptPath)).toBe(false);
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

  describe("appendMessage", () => {
    it("appends messages to JSONL file", async () => {
      const created = sm.create();
      const msg1: SessionMessage = { role: "user", content: "Hi", timestamp: "2026-01-01T00:00:00Z" };
      const msg2: SessionMessage = { role: "assistant", content: "Hello!", timestamp: "2026-01-01T00:00:01Z" };

      await sm.appendMessage(created.id, msg1);
      await sm.appendMessage(created.id, msg2);

      const transcriptPath = join(tempDir, "transcripts", `${created.id}.jsonl`);
      const lines = readFileSync(transcriptPath, "utf-8").trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]!)).toEqual(msg1);
      expect(JSON.parse(lines[1]!)).toEqual(msg2);
    });

    it("throws when session does not exist", async () => {
      const msg: SessionMessage = { role: "user", content: "test", timestamp: new Date().toISOString() };
      await expect(sm.appendMessage("nonexistent-id", msg)).rejects.toThrow("Session not found");
    });

    it("updates session updatedAt", async () => {
      const created = sm.create();
      const originalUpdatedAt = created.updatedAt;

      // Wait to ensure timestamp difference
      await new Promise((r) => setTimeout(r, 10));

      const msg: SessionMessage = { role: "user", content: "test", timestamp: new Date().toISOString() };
      await sm.appendMessage(created.id, msg);

      const session = await sm.get(created.id);
      expect(session!.updatedAt).not.toBe(originalUpdatedAt);
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
    it("creates transcript directory if not exists", () => {
      const nestedDir = join(tempDir, "deep", "nested", "transcripts");
      const sm2 = createSessionManager(db, nestedDir);
      expect(existsSync(nestedDir)).toBe(true);
      // Use sm2 to suppress unused warning
      expect(sm2.list()).toEqual([]);
    });

    it("skips malformed lines in JSONL transcript", async () => {
      const created = sm.create();
      const transcriptPath = join(tempDir, "transcripts", `${created.id}.jsonl`);
      const { writeFileSync: writeFn } = require("node:fs") as typeof import("node:fs");
      writeFn(transcriptPath, '{"role":"user","content":"ok","timestamp":"t"}\nnot-json\n{"role":"assistant","content":"hi","timestamp":"t2"}\n');

      const session = await sm.get(created.id);
      expect(session!.messages).toHaveLength(2);
      expect(session!.messages[0].content).toBe("ok");
      expect(session!.messages[1].content).toBe("hi");
    });

    it("handles empty JSONL file gracefully", async () => {
      const created = sm.create();
      // Create empty file
      const transcriptPath = join(tempDir, "transcripts", `${created.id}.jsonl`);
      const { writeFileSync } = require("node:fs") as typeof import("node:fs");
      writeFileSync(transcriptPath, "");

      const session = await sm.get(created.id);
      expect(session!.messages).toEqual([]);
    });
  });
});
