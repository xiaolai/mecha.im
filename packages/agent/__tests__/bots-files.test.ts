import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify from "fastify";
import { registerBotFileRoutes } from "../src/routes/bots-files.js";

describe("bot file routes", () => {
  let mechaDir: string;
  let botDir: string;

  beforeEach(() => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-files-"));
    botDir = join(mechaDir, "alice");
    mkdirSync(botDir, { recursive: true });
    // Write a minimal config.json so the bot is "found"
    writeFileSync(join(botDir, "config.json"), JSON.stringify({
      port: 7700, token: "t", workspace: "/tmp",
    }));
    // Create some files in the bot's home
    writeFileSync(join(botDir, "readme.md"), "# Alice Bot");
    writeFileSync(join(botDir, "notes.txt"), "plain text");
    mkdirSync(join(botDir, "docs"));
    writeFileSync(join(botDir, "docs", "guide.md"), "# Guide");
    writeFileSync(join(botDir, ".hidden"), "secret");
  });

  afterEach(() => {
    rmSync(mechaDir, { recursive: true, force: true });
  });

  function buildApp() {
    const app = Fastify();
    registerBotFileRoutes(app, mechaDir);
    return app;
  }

  describe("GET /bots/:name/files", () => {
    it("lists root directory entries", async () => {
      const app = buildApp();
      const res = await app.inject({ method: "GET", url: "/bots/alice/files" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.home).toBe(botDir);
      expect(body.path).toBe("");
      const names = body.entries.map((e: { name: string }) => e.name);
      expect(names).toContain("readme.md");
      expect(names).toContain("docs");
      expect(names).not.toContain(".hidden");
    });

    it("lists subdirectory", async () => {
      const app = buildApp();
      const res = await app.inject({ method: "GET", url: "/bots/alice/files?path=docs" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.entries).toHaveLength(1);
      expect(body.entries[0].name).toBe("guide.md");
    });

    it("returns 404 for unknown bot", async () => {
      const app = buildApp();
      const res = await app.inject({ method: "GET", url: "/bots/nobody/files" });
      expect(res.statusCode).toBe(404);
    });

    it("returns 400 for path traversal", async () => {
      const app = buildApp();
      const res = await app.inject({ method: "GET", url: "/bots/alice/files?path=../" });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/traversal/i);
    });

    it("returns 400 for invalid bot name", async () => {
      const app = buildApp();
      const res = await app.inject({ method: "GET", url: "/bots/!!invalid/files" });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /bots/:name/files/read", () => {
    it("reads a markdown file", async () => {
      const app = buildApp();
      const res = await app.inject({ method: "GET", url: "/bots/alice/files/read?path=readme.md" });
      expect(res.statusCode).toBe(200);
      expect(res.json().content).toBe("# Alice Bot");
    });

    it("rejects non-markdown file", async () => {
      const app = buildApp();
      const res = await app.inject({ method: "GET", url: "/bots/alice/files/read?path=notes.txt" });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/markdown/i);
    });

    it("returns 404 for missing file", async () => {
      const app = buildApp();
      const res = await app.inject({ method: "GET", url: "/bots/alice/files/read?path=missing.md" });
      expect(res.statusCode).toBe(404);
    });

    it("returns 400 when path is missing", async () => {
      const app = buildApp();
      const res = await app.inject({ method: "GET", url: "/bots/alice/files/read" });
      expect(res.statusCode).toBe(400);
    });

    it("rejects path traversal", async () => {
      const app = buildApp();
      const res = await app.inject({ method: "GET", url: "/bots/alice/files/read?path=../../etc/passwd.md" });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("PUT /bots/:name/files/write", () => {
    it("writes a new markdown file", async () => {
      const app = buildApp();
      const res = await app.inject({
        method: "PUT",
        url: "/bots/alice/files/write",
        payload: { path: "new.md", content: "# New" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);

      // Verify it was written
      const read = await app.inject({ method: "GET", url: "/bots/alice/files/read?path=new.md" });
      expect(read.json().content).toBe("# New");
    });

    it("rejects non-markdown file", async () => {
      const app = buildApp();
      const res = await app.inject({
        method: "PUT",
        url: "/bots/alice/files/write",
        payload: { path: "hack.sh", content: "#!/bin/bash" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/markdown/i);
    });

    it("returns 400 when path is missing", async () => {
      const app = buildApp();
      const res = await app.inject({
        method: "PUT",
        url: "/bots/alice/files/write",
        payload: { content: "no path" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 when content is missing", async () => {
      const app = buildApp();
      const res = await app.inject({
        method: "PUT",
        url: "/bots/alice/files/write",
        payload: { path: "test.md" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("rejects path traversal", async () => {
      const app = buildApp();
      const res = await app.inject({
        method: "PUT",
        url: "/bots/alice/files/write",
        payload: { path: "../escape.md", content: "bad" },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
