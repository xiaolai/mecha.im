import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify from "fastify";
import { registerSettingsRoutes } from "../../src/routes/settings.js";

vi.mock("@mecha/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mecha/service")>();
  return {
    ...actual,
    readNodeName: vi.fn(),
  };
});

import { readNodeName } from "@mecha/service";
const mockReadNodeName = vi.mocked(readNodeName);

describe("settings node routes", () => {
  let mechaDir: string;

  beforeEach(() => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-test-"));
  });

  afterEach(() => {
    rmSync(mechaDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("GET /settings/node returns node name", async () => {
    mockReadNodeName.mockReturnValue("alpha" as never);
    const app = Fastify();
    registerSettingsRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/settings/node" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ name: "alpha" });
    await app.close();
  });

  it("GET /settings/node returns null when no name set", async () => {
    mockReadNodeName.mockReturnValue(undefined as never);
    const app = Fastify();
    registerSettingsRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/settings/node" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ name: null });
    await app.close();
  });

  it("PATCH /settings/node rejects empty name", async () => {
    const app = Fastify();
    registerSettingsRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({
      method: "PATCH",
      url: "/settings/node",
      payload: { name: "" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("required");
    await app.close();
  });

  it("PATCH /settings/node rejects missing name field", async () => {
    const app = Fastify();
    registerSettingsRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({
      method: "PATCH",
      url: "/settings/node",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("required");
    await app.close();
  });

  it("PATCH /settings/node rejects invalid name", async () => {
    const app = Fastify();
    registerSettingsRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({
      method: "PATCH",
      url: "/settings/node",
      payload: { name: "BAD NAME!" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("Invalid node name");
    await app.close();
  });

  it("PATCH /settings/node returns unchanged when name matches existing", async () => {
    mockReadNodeName.mockReturnValue("alpha" as never);
    const app = Fastify();
    registerSettingsRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({
      method: "PATCH",
      url: "/settings/node",
      payload: { name: "alpha" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ name: "alpha", changed: false });
    await app.close();
  });

  it("PATCH /settings/node writes node.json and returns changed", async () => {
    mockReadNodeName.mockReturnValue(undefined as never);
    const app = Fastify();
    registerSettingsRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({
      method: "PATCH",
      url: "/settings/node",
      payload: { name: "beta" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe("beta");
    expect(body.changed).toBe(true);
    expect(body.note).toContain("Restart");

    // Verify the file was actually written
    const nodePath = join(mechaDir, "node.json");
    const written = JSON.parse(readFileSync(nodePath, "utf-8"));
    expect(written.name).toBe("beta");
    expect(written.createdAt).toBeDefined();
    await app.close();
  });

  it("PATCH /settings/node renames from existing name", async () => {
    mockReadNodeName.mockReturnValue("alpha" as never);
    const app = Fastify();
    registerSettingsRoutes(app, { mechaDir });
    await app.ready();
    const res = await app.inject({
      method: "PATCH",
      url: "/settings/node",
      payload: { name: "gamma" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(
      expect.objectContaining({ name: "gamma", changed: true }),
    );

    const nodePath = join(mechaDir, "node.json");
    const written = JSON.parse(readFileSync(nodePath, "utf-8"));
    expect(written.name).toBe("gamma");
    await app.close();
  });
});
