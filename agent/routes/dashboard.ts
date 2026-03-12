import { Hono } from "hono";
import { resolve, normalize } from "node:path";

const DASHBOARD_ROOT = "/app/agent/dashboard/dist";

const MIME_TYPES: Record<string, string> = {
  html: "text/html",
  js: "application/javascript",
  css: "text/css",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
};

export function createDashboardRoutes(): Hono {
  const app = new Hono();

  app.get("/dashboard/*", async (c) => {
    const reqPath = c.req.path.replace("/dashboard", "") || "/index.html";
    const resolved = resolve(DASHBOARD_ROOT, reqPath.replace(/^\//, ""));
    const normalized = normalize(resolved);

    // Path traversal protection
    if (normalized !== DASHBOARD_ROOT && !normalized.startsWith(DASHBOARD_ROOT + "/")) {
      return c.json({ error: "Forbidden" }, 403);
    }

    try {
      const { readFile } = await import("node:fs/promises");
      const content = await readFile(normalized);
      const ext = normalized.split(".").pop() ?? "";
      return c.body(content, 200, {
        "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream",
      });
    } catch {
      // SPA fallback
      try {
        const { readFile } = await import("node:fs/promises");
        const html = await readFile(`${DASHBOARD_ROOT}/index.html`);
        return c.body(html, 200, { "Content-Type": "text/html" });
      } catch {
        return c.json({ error: "Dashboard not built" }, 404);
      }
    }
  });

  return app;
}
