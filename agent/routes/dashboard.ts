import { Hono } from "hono";
import { resolve, normalize, join } from "node:path";
import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";

// Hot-reload path (writable bind-mount) takes priority over image-baked dist
const HOT_DASHBOARD_ROOT = "/state/dashboard-dist";
const DEFAULT_DASHBOARD_ROOT = "/app/agent/dashboard/dist";
const COOKIE_NAME = "mecha_session";

function getDashboardRoot(): string {
  return existsSync(join(HOT_DASHBOARD_ROOT, "index.html"))
    ? HOT_DASHBOARD_ROOT
    : DEFAULT_DASHBOARD_ROOT;
}

const MIME_TYPES: Record<string, string> = {
  html: "text/html",
  js: "application/javascript",
  css: "text/css",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
};

function makeSessionToken(botToken: string): string {
  return createHmac("sha256", botToken).update("mecha-dashboard-session").digest("hex");
}

export function verifySessionCookie(cookieHeader: string | undefined, botToken: string): boolean {
  if (!cookieHeader) return false;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  if (!match) return false;
  const received = Buffer.from(match[1]);
  const expected = Buffer.from(makeSessionToken(botToken));
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function createDashboardRoutes(botToken: string): Hono {
  const app = new Hono();
  const sessionToken = makeSessionToken(botToken);

  function setSessionCookie(c: import("hono").Context): void {
    c.header("Set-Cookie", `${COOKIE_NAME}=${sessionToken}; Path=/; HttpOnly; SameSite=Strict`);
  }

  // Redirect /dashboard to /dashboard/ for consistent relative paths
  app.get("/dashboard", (c) => c.redirect("/dashboard/"));

  app.get("/dashboard/*", async (c) => {
    const dashboardRoot = getDashboardRoot();
    const reqPath = c.req.path.replace("/dashboard", "") || "/index.html";
    // Treat bare /dashboard/ as index.html
    const filePath = reqPath === "/" ? "/index.html" : reqPath;
    const resolved = resolve(dashboardRoot, filePath.replace(/^\//, ""));
    const normalized = normalize(resolved);

    // Path traversal protection
    if (normalized !== dashboardRoot && !normalized.startsWith(dashboardRoot + "/")) {
      return c.json({ error: "Forbidden" }, 403);
    }

    try {
      const { readFile } = await import("node:fs/promises");
      const content = await readFile(normalized);
      const ext = normalized.split(".").pop() ?? "";
      const isHtml = ext === "html";
      if (isHtml) setSessionCookie(c);
      return c.body(content, 200, {
        "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream",
      });
    } catch {
      // SPA fallback — serve index.html for client-side routing
      try {
        const { readFile } = await import("node:fs/promises");
        const html = await readFile(`${dashboardRoot}/index.html`);
        setSessionCookie(c);
        return c.body(html, 200, { "Content-Type": "text/html" });
      } catch {
        return c.json({ error: "Dashboard not built" }, 404);
      }
    }
  });

  return app;
}
