import { Hono } from "hono";
import { resolve, normalize } from "node:path";
import { createHmac, timingSafeEqual } from "node:crypto";

const DASHBOARD_ROOT = "/app/agent/dashboard/dist";
const COOKIE_NAME = "mecha_session";

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
    const reqPath = c.req.path.replace("/dashboard", "") || "/index.html";
    // Treat bare /dashboard/ as index.html
    const filePath = reqPath === "/" ? "/index.html" : reqPath;
    const resolved = resolve(DASHBOARD_ROOT, filePath.replace(/^\//, ""));
    const normalized = normalize(resolved);

    // Path traversal protection
    if (normalized !== DASHBOARD_ROOT && !normalized.startsWith(DASHBOARD_ROOT + "/")) {
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
        const html = await readFile(`${DASHBOARD_ROOT}/index.html`);
        setSessionCookie(c);
        return c.body(html, 200, { "Content-Type": "text/html" });
      } catch {
        return c.json({ error: "Dashboard not built" }, 404);
      }
    }
  });

  return app;
}
