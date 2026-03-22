import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AclEngine } from "@mecha/core";
import { readTask, tasksDir } from "@mecha/core";
import { createAgentServer } from "../src/server.js";
import { deriveSessionKey, createSessionToken } from "../src/session.js";

const TEST_TOTP_SECRET = "JBSWY3DPEHPK3PXP";

function makeAuthCookie(): string {
  const sessionKey = deriveSessionKey(TEST_TOTP_SECRET);
  const token = createSessionToken(sessionKey, 1);
  return `mecha-session=${token}`;
}

function makeAcl(overrides: Partial<AclEngine> = {}): AclEngine {
  return {
    grant: vi.fn(), revoke: vi.fn(),
    check: vi.fn().mockReturnValue({ allowed: true }),
    listRules: vi.fn().mockReturnValue([]),
    listConnections: vi.fn().mockReturnValue([]),
    save: vi.fn(),
    ...overrides,
  } as unknown as AclEngine;
}

describe("agent task routes", () => {
  let mechaDir: string;
  let server: ReturnType<typeof createAgentServer>;
  let port: number;

  beforeAll(async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "agent-task-test-"));
    // Write a bot config
    const botDir = join(mechaDir, "analyst");
    mkdirSync(botDir, { recursive: true });
    writeFileSync(join(botDir, "config.json"), JSON.stringify({
      port: 9999, token: "test-token", workspace: "/tmp",
    }));

    server = createAgentServer({
      port: 0,
      auth: { totpSecret: TEST_TOTP_SECRET, apiKey: "test-key" },
      processManager: {} as never,
      acl: makeAcl(),
      mechaDir,
      nodeName: "test-node",
    });
    const addr = await server.listen({ port: 0, host: "127.0.0.1" });
    port = parseInt(new URL(addr).port, 10);
  });

  afterAll(async () => {
    await server.close();
    rmSync(mechaDir, { recursive: true, force: true });
  });

  afterEach(() => { vi.clearAllMocks(); });

  const cookie = makeAuthCookie();

  it("POST /tasks creates a task and returns 201", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/tasks`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-mecha-source": "admin",
      },
      body: JSON.stringify({ target: "analyst", message: "Review code" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { id: string; status: string };
    expect(body.id).toMatch(/^task-[0-9a-f]{16}$/);
    expect(body.status).toBe("pending");

    // Verify task was written to storage
    const dir = tasksDir(mechaDir);
    const task = readTask(dir, body.id);
    expect(task).toBeDefined();
    expect(task!.target).toBe("analyst");
  });

  it("POST /tasks returns 400 for invalid input", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ target: "analyst" }), // missing message
    });
    expect(res.status).toBe(400);
  });

  it("POST /tasks returns 404 for non-existent bot", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-mecha-source": "admin" },
      body: JSON.stringify({ target: "nonexistent", message: "hello" }),
    });
    expect(res.status).toBe(404);
  });

  it("GET /tasks returns task list", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/tasks`, {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  it("GET /tasks/:id returns a specific task", async () => {
    // Create a task first
    const createRes = await fetch(`http://127.0.0.1:${port}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-mecha-source": "admin" },
      body: JSON.stringify({ target: "analyst", message: "Specific task" }),
    });
    const { id } = await createRes.json() as { id: string };

    const res = await fetch(`http://127.0.0.1:${port}/tasks/${id}`, {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const task = await res.json() as { id: string; message: string };
    expect(task.id).toBe(id);
    expect(task.message).toBe("Specific task");
  });

  it("GET /tasks/:id returns 404 for missing task", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/tasks/nonexistent`, {
      headers: { cookie },
    });
    expect(res.status).toBe(404);
  });

  it("POST /tasks/:id/cancel cancels a task", async () => {
    // Create a task — it will async-fail because port 9999 is not running,
    // so we manually write a "working" task to test cancel on
    const { writeTask } = await import("@mecha/core");
    const dir = tasksDir(mechaDir);
    const id = "task-cancel-test";
    writeTask(dir, {
      id, source: "admin", target: "analyst", status: "working",
      message: "Cancel me", createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const res = await fetch(`http://127.0.0.1:${port}/tasks/${id}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: "{}",
    });
    expect(res.status).toBe(200);

    const task = readTask(dir, id);
    expect(task!.status).toBe("cancelled");
  });

  it("POST /tasks/:id/cancel returns 409 for completed task", async () => {
    // Create and manually complete a task
    const createRes = await fetch(`http://127.0.0.1:${port}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-mecha-source": "admin" },
      body: JSON.stringify({ target: "analyst", message: "Done task" }),
    });
    const { id } = await createRes.json() as { id: string };

    // Manually set to completed
    const dir = tasksDir(mechaDir);
    const task = readTask(dir, id)!;
    task.status = "completed";
    task.updatedAt = new Date().toISOString();
    const { writeTask } = await import("@mecha/core");
    writeTask(dir, task);

    const res = await fetch(`http://127.0.0.1:${port}/tasks/${id}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: "{}",
    });
    expect(res.status).toBe(409);
  });

  it("PATCH /tasks/:id updates task with result", async () => {
    // Manually create a working task
    const { writeTask } = await import("@mecha/core");
    const dir = tasksDir(mechaDir);
    const id = "task-patch-test";
    writeTask(dir, {
      id, source: "admin", target: "analyst", status: "working",
      message: "Patch me", createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const res = await fetch(`http://127.0.0.1:${port}/tasks/${id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-key",
      },
      body: JSON.stringify({
        status: "completed",
        result: "All tests pass",
        sessionId: "sess-42",
        durationMs: 1200,
        costUsd: 0.03,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { updated: boolean };
    expect(body.updated).toBe(true);

    // Verify disk was updated
    const task = readTask(dir, id);
    expect(task).toBeDefined();
    expect(task!.status).toBe("completed");
    expect(task!.result).toBe("All tests pass");
    expect(task!.sessionId).toBe("sess-42");
    expect(task!.durationMs).toBe(1200);
    expect(task!.costUsd).toBe(0.03);
  });

  it("PATCH /tasks/:id returns 404 for missing task", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/tasks/nonexistent-patch`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-key",
      },
      body: JSON.stringify({ status: "completed", result: "done" }),
    });
    expect(res.status).toBe(404);
  });

  it("PATCH /tasks/:id updates error field for failed tasks", async () => {
    const { writeTask } = await import("@mecha/core");
    const dir = tasksDir(mechaDir);
    const id = "task-patch-fail";
    writeTask(dir, {
      id, source: "admin", target: "analyst", status: "working",
      message: "Will fail", createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const res = await fetch(`http://127.0.0.1:${port}/tasks/${id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-key",
      },
      body: JSON.stringify({ status: "failed", error: "SDK query failed" }),
    });
    expect(res.status).toBe(200);

    const task = readTask(dir, id);
    expect(task!.status).toBe("failed");
    expect(task!.error).toBe("SDK query failed");
  });

  it("returns 401 without auth", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "analyst", message: "hello" }),
    });
    expect(res.status).toBe(401);
  });
});
