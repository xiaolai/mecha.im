import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { runMigrations } from "@mecha/runtime";
import { createSessionManager } from "@mecha/runtime";
import { registerSessionRoutes } from "@mecha/runtime";
import type { ProcessManager } from "@mecha/process";
import type { CasaName } from "@mecha/core";
import {
  casaSessionList,
  casaSessionGet,
  casaSessionCreate,
  casaSessionDelete,
  casaSessionRename,
  casaSessionMessage,
  casaSessionInterrupt,
} from "../src/sessions.js";

const CASA = "test" as CasaName;
const TOKEN = "test-token";

describe("session service", () => {
  let app: FastifyInstance;
  let db: InstanceType<typeof Database>;
  let tempDir: string;
  let port: number;
  let pm: ProcessManager;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-svc-sessions-"));
    db = new Database(":memory:");
    runMigrations(db);
    const sm = createSessionManager(db, join(tempDir, "transcripts"));

    app = Fastify();
    registerSessionRoutes(app, sm);
    await app.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.server.address();
    port = typeof addr === "object" && addr ? addr.port : 0;

    pm = {
      spawn: vi.fn(),
      get: vi.fn().mockReturnValue({ name: CASA, state: "running" }),
      list: vi.fn().mockReturnValue([]),
      stop: vi.fn(),
      kill: vi.fn(),
      logs: vi.fn(),
      getPortAndToken: vi.fn().mockReturnValue({ port, token: TOKEN }),
      onEvent: vi.fn().mockReturnValue(() => {}),
    } as ProcessManager;
  });

  afterEach(async () => {
    await app.close();
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("lists sessions (empty)", async () => {
    const result = await casaSessionList(pm, CASA);
    expect(result).toEqual([]);
  });

  it("creates a session", async () => {
    const result = await casaSessionCreate(pm, CASA, { title: "My Session" });
    expect((result as { title: string }).title).toBe("My Session");
  });

  it("creates a session without options", async () => {
    const result = await casaSessionCreate(pm, CASA);
    expect((result as { id: string }).id).toBeDefined();
  });

  it("gets a session", async () => {
    const created = (await casaSessionCreate(pm, CASA, { title: "Test" })) as { id: string };
    const result = await casaSessionGet(pm, CASA, created.id);
    expect((result as { title: string }).title).toBe("Test");
  });

  it("returns undefined for nonexistent session", async () => {
    const result = await casaSessionGet(pm, CASA, "nonexistent");
    expect(result).toBeUndefined();
  });

  it("deletes a session", async () => {
    const created = (await casaSessionCreate(pm, CASA)) as { id: string };
    const deleted = await casaSessionDelete(pm, CASA, created.id);
    expect(deleted).toBe(true);
  });

  it("renames a session", async () => {
    const created = (await casaSessionCreate(pm, CASA, { title: "Old" })) as { id: string };
    const renamed = await casaSessionRename(pm, CASA, created.id, "New");
    expect(renamed).toBe(true);
  });

  it("sends a message to a session", async () => {
    const created = (await casaSessionCreate(pm, CASA)) as { id: string };
    const result = await casaSessionMessage(pm, CASA, created.id, {
      role: "user",
      content: "Hello",
    });
    expect((result as { role: string }).role).toBe("user");
  });

  it("interrupts a session", async () => {
    // Interrupt returns false for non-busy session (409)
    const created = (await casaSessionCreate(pm, CASA)) as { id: string };
    const result = await casaSessionInterrupt(pm, CASA, created.id);
    expect(result).toBe(false); // not busy, so interrupt returns 409
  });
});
