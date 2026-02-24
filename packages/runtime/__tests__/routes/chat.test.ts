import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/database.js";
import { createSessionManager } from "../../src/session-manager.js";
import { registerChatRoutes } from "../../src/routes/chat.js";
import type { SessionManager } from "../../src/session-manager.js";

describe("chat routes", () => {
  let app: FastifyInstance;
  let db: InstanceType<typeof Database>;
  let sm: SessionManager;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-chat-test-"));
    db = new Database(":memory:");
    runMigrations(db);
    sm = createSessionManager(db, join(tempDir, "transcripts"));

    app = Fastify();
    registerChatRoutes(app, sm);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns 400 for missing message", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { sessionId: "abc" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("message is required");
  });

  it("returns 400 for empty message", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("creates a new session and streams echo response", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "Hello world" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream");

    const lines = res.body.split("\n").filter((l) => l.startsWith("data: "));
    expect(lines.length).toBeGreaterThanOrEqual(2); // at least one text chunk + done

    // Last data line should be "done"
    const lastEvent = JSON.parse(lines[lines.length - 1].replace("data: ", ""));
    expect(lastEvent.type).toBe("done");
    expect(lastEvent.sessionId).toBeDefined();

    // Text chunks should contain echo content
    const textEvents = lines
      .map((l) => JSON.parse(l.replace("data: ", "")))
      .filter((e: { type: string }) => e.type === "text");
    expect(textEvents.length).toBeGreaterThan(0);
  });

  it("uses existing session when sessionId is provided", async () => {
    const session = sm.create({ title: "Existing" });
    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "Hi", sessionId: session.id },
    });
    expect(res.statusCode).toBe(200);

    // Session should have messages appended
    const updated = await sm.get(session.id);
    expect(updated!.messages).toHaveLength(2); // user + assistant
    expect(updated!.messages[0].role).toBe("user");
    expect(updated!.messages[1].role).toBe("assistant");
  });

  it("returns 404 for nonexistent sessionId", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "Hi", sessionId: "nonexistent" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 409 when session is busy", async () => {
    const session = sm.create();
    sm.setBusy(session.id, true);
    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "Hi", sessionId: session.id },
    });
    expect(res.statusCode).toBe(409);
  });

  it("auto-creates session with truncated title from message", async () => {
    const longMessage = "A".repeat(100);
    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: longMessage },
    });
    expect(res.statusCode).toBe(200);

    // Parse done event to get sessionId
    const lines = res.body.split("\n").filter((l) => l.startsWith("data: "));
    const doneEvent = JSON.parse(lines[lines.length - 1].replace("data: ", ""));
    const session = await sm.get(doneEvent.sessionId);
    expect(session!.title).toBe("A".repeat(50));
  });

  it("clears busy flag after streaming completes", async () => {
    const session = sm.create();
    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "Test", sessionId: session.id },
    });
    expect(res.statusCode).toBe(200);
    expect(sm.isBusy(session.id)).toBe(false);
  });
});
