import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify from "fastify";
import { registerBudgetRoutes } from "../../src/routes/budgets.js";

describe("budget routes", () => {
  let mechaDir: string;

  beforeEach(() => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-test-"));
    mkdirSync(join(mechaDir, "meter"), { recursive: true });
  });

  afterEach(() => {
    rmSync(mechaDir, { recursive: true, force: true });
  });

  it("GET /budgets returns empty config initially", async () => {
    const app = Fastify();
    registerBudgetRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/budgets" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.global).toBeDefined();
    expect(body.byBot).toBeDefined();
    expect(body.byAuthProfile).toBeDefined();
    expect(body.byTag).toBeDefined();
    await app.close();
  });

  it("POST /budgets sets a global daily budget", async () => {
    const app = Fastify();
    registerBudgetRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/budgets",
      payload: { scope: "global", daily: 10 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const get = await app.inject({ method: "GET", url: "/budgets" });
    expect(get.json().global.dailyUsd).toBe(10);
    await app.close();
  });

  it("POST /budgets sets a bot monthly budget", async () => {
    const app = Fastify();
    registerBudgetRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/budgets",
      payload: { scope: "bot", name: "alice", monthly: 50 },
    });
    expect(res.statusCode).toBe(200);

    const get = await app.inject({ method: "GET", url: "/budgets" });
    expect(get.json().byBot.alice.monthlyUsd).toBe(50);
    await app.close();
  });

  it("POST /budgets sets an auth-profile budget", async () => {
    const app = Fastify();
    registerBudgetRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/budgets",
      payload: { scope: "auth-profile", name: "default", daily: 5 },
    });
    expect(res.statusCode).toBe(200);

    const get = await app.inject({ method: "GET", url: "/budgets" });
    expect(get.json().byAuthProfile.default.dailyUsd).toBe(5);
    await app.close();
  });

  it("POST /budgets sets a tag budget", async () => {
    const app = Fastify();
    registerBudgetRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/budgets",
      payload: { scope: "tag", name: "web", monthly: 20 },
    });
    expect(res.statusCode).toBe(200);

    const get = await app.inject({ method: "GET", url: "/budgets" });
    expect(get.json().byTag.web.monthlyUsd).toBe(20);
    await app.close();
  });

  it("POST /budgets rejects missing scope", async () => {
    const app = Fastify();
    registerBudgetRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/budgets",
      payload: { daily: 10 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("scope");
    await app.close();
  });

  it("POST /budgets rejects missing name for non-global scope", async () => {
    const app = Fastify();
    registerBudgetRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/budgets",
      payload: { scope: "bot", daily: 10 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("name");
    await app.close();
  });

  it("POST /budgets rejects missing daily and monthly", async () => {
    const app = Fastify();
    registerBudgetRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/budgets",
      payload: { scope: "global" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("daily or monthly");
    await app.close();
  });

  it("POST /budgets rejects invalid scope", async () => {
    const app = Fastify();
    registerBudgetRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/budgets",
      payload: { scope: "invalid", name: "x", daily: 10 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("Invalid scope");
    await app.close();
  });

  it("DELETE /budgets removes a budget", async () => {
    const app = Fastify();
    registerBudgetRoutes(app, { mechaDir });
    await app.ready();
    // Set a budget first
    await app.inject({
      method: "POST",
      url: "/budgets",
      payload: { scope: "global", daily: 10 },
    });
    // Remove it
    const res = await app.inject({
      method: "DELETE",
      url: "/budgets?scope=global&period=daily",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    // Verify it's gone
    const get = await app.inject({ method: "GET", url: "/budgets" });
    expect(get.json().global.dailyUsd).toBeUndefined();
    await app.close();
  });

  it("DELETE /budgets returns 404 for nonexistent", async () => {
    const app = Fastify();
    registerBudgetRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({
      method: "DELETE",
      url: "/budgets?scope=global&period=daily",
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain("not found");
    await app.close();
  });

  it("DELETE /budgets rejects missing params", async () => {
    const app = Fastify();
    registerBudgetRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({
      method: "DELETE",
      url: "/budgets?scope=global",
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("DELETE /budgets rejects invalid period", async () => {
    const app = Fastify();
    registerBudgetRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({
      method: "DELETE",
      url: "/budgets?scope=global&period=weekly",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("period must be daily or monthly");
    await app.close();
  });

  it("DELETE /budgets rejects missing name for non-global scope", async () => {
    const app = Fastify();
    registerBudgetRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({
      method: "DELETE",
      url: "/budgets?scope=bot&period=daily",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("name");
    await app.close();
  });

  it("DELETE /budgets rejects invalid scope", async () => {
    const app = Fastify();
    registerBudgetRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({
      method: "DELETE",
      url: "/budgets?scope=invalid&name=x&period=daily",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("Invalid scope");
    await app.close();
  });
});
