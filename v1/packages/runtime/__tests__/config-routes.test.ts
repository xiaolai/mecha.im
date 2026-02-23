import { describe, it, expect, afterEach } from "vitest";
import { createServer } from "../src/server.js";
import Database from "better-sqlite3";
import { runMigrations } from "../src/db/sqlite.js";
import type { MechaId } from "@mecha/core";

const TEST_ID = "mx-test-config" as MechaId;

function createTestApp(opts?: { withDb?: boolean }) {
  const withDb = opts?.withDb !== false;
  let db: Database.Database | undefined;
  if (withDb) {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
  }
  return createServer({
    mechaId: TEST_ID,
    skipMcp: true,
    skipAuth: true,
    db,
    agent: { workingDirectory: "/tmp", permissionMode: "default" as const },
  });
}

describe("Config routes", () => {
  let app: ReturnType<typeof createServer>;

  afterEach(async () => {
    if (app) await app.close();
  });

  // --- 503 when no config store ---

  it("GET /api/config returns 503 without db", async () => {
    app = createTestApp({ withDb: false });
    const res = await app.inject({ method: "GET", url: "/api/config" });
    expect(res.statusCode).toBe(503);
  });

  it("GET /api/config/:key returns 503 without db", async () => {
    app = createTestApp({ withDb: false });
    const res = await app.inject({ method: "GET", url: "/api/config/foo" });
    expect(res.statusCode).toBe(503);
  });

  it("PUT /api/config/:key returns 503 without db", async () => {
    app = createTestApp({ withDb: false });
    const res = await app.inject({ method: "PUT", url: "/api/config/foo", payload: { value: "bar" } });
    expect(res.statusCode).toBe(503);
  });

  it("DELETE /api/config/:key returns 503 without db", async () => {
    app = createTestApp({ withDb: false });
    const res = await app.inject({ method: "DELETE", url: "/api/config/foo" });
    expect(res.statusCode).toBe(503);
  });

  // --- CRUD operations ---

  it("PUT /api/config/:key sets a value", async () => {
    app = createTestApp();
    const res = await app.inject({
      method: "PUT",
      url: "/api/config/system_prompt",
      payload: { value: "You are helpful" },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ key: "system_prompt", value: "You are helpful" });
  });

  it("PUT /api/config/:key without value returns 400", async () => {
    app = createTestApp();
    const res = await app.inject({ method: "PUT", url: "/api/config/foo", payload: {} });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain("value");
  });

  it("PUT /api/config/:key with null body returns 400", async () => {
    app = createTestApp();
    const res = await app.inject({
      method: "PUT",
      url: "/api/config/foo",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(null),
    });
    expect(res.statusCode).toBe(400);
  });

  it("PUT /api/config/:key with non-string value returns 400", async () => {
    app = createTestApp();
    const res = await app.inject({ method: "PUT", url: "/api/config/foo", payload: { value: 123 } });
    expect(res.statusCode).toBe(400);
  });

  it("GET /api/config/:key returns the value", async () => {
    app = createTestApp();
    await app.inject({ method: "PUT", url: "/api/config/foo", payload: { value: "bar" } });

    const res = await app.inject({ method: "GET", url: "/api/config/foo" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ key: "foo", value: "bar" });
  });

  it("GET /api/config/:key returns 404 for missing key", async () => {
    app = createTestApp();
    const res = await app.inject({ method: "GET", url: "/api/config/nonexistent" });
    expect(res.statusCode).toBe(404);
  });

  it("GET /api/config lists all entries", async () => {
    app = createTestApp();
    await app.inject({ method: "PUT", url: "/api/config/alpha", payload: { value: "1" } });
    await app.inject({ method: "PUT", url: "/api/config/beta", payload: { value: "2" } });

    const res = await app.inject({ method: "GET", url: "/api/config" });
    expect(res.statusCode).toBe(200);
    const entries = JSON.parse(res.body);
    expect(entries).toHaveLength(2);
    expect(entries[0].key).toBe("alpha");
    expect(entries[1].key).toBe("beta");
  });

  it("GET /api/config with prefix filter", async () => {
    app = createTestApp();
    await app.inject({ method: "PUT", url: "/api/config/mecha.prompt", payload: { value: "hello" } });
    await app.inject({ method: "PUT", url: "/api/config/mecha.turns", payload: { value: "5" } });
    await app.inject({ method: "PUT", url: "/api/config/other", payload: { value: "unrelated" } });

    const res = await app.inject({ method: "GET", url: "/api/config?prefix=mecha." });
    expect(res.statusCode).toBe(200);
    const entries = JSON.parse(res.body);
    expect(entries).toHaveLength(2);
  });

  it("DELETE /api/config/:key removes the value", async () => {
    app = createTestApp();
    await app.inject({ method: "PUT", url: "/api/config/temp", payload: { value: "data" } });

    const res = await app.inject({ method: "DELETE", url: "/api/config/temp" });
    expect(res.statusCode).toBe(204);

    const get = await app.inject({ method: "GET", url: "/api/config/temp" });
    expect(get.statusCode).toBe(404);
  });

  it("DELETE /api/config/:key returns 404 for missing key", async () => {
    app = createTestApp();
    const res = await app.inject({ method: "DELETE", url: "/api/config/nonexistent" });
    expect(res.statusCode).toBe(404);
  });

  it("PUT /api/config/:key updates existing value", async () => {
    app = createTestApp();
    await app.inject({ method: "PUT", url: "/api/config/key1", payload: { value: "v1" } });
    await app.inject({ method: "PUT", url: "/api/config/key1", payload: { value: "v2" } });

    const res = await app.inject({ method: "GET", url: "/api/config/key1" });
    expect(JSON.parse(res.body).value).toBe("v2");
  });
});
