import { timingSafeEqual } from "node:crypto";
import { listBots as listRegistered } from "./store.js";
import { resolveHostBotBaseUrl } from "./resolve-endpoint.js";
import { MechaError } from "../shared/errors.js";
import { log } from "../shared/logger.js";
import { DASHBOARD_TOKEN, DASHBOARD_COOKIE } from "./dashboard-server-schema.js";
import type { Context } from "hono";

/** Check if a bot is currently busy by querying its /api/status endpoint.
 *  Returns `unknown: true` if status could not be determined (bot unreachable). */
export async function checkBotBusy(name: string): Promise<{ busy: boolean; unknown?: boolean; state?: string }> {
  try {
    const resolved = await resolveHostBotBaseUrl(name, { allowRemote: false });
    if (!resolved) return { busy: false, unknown: true, state: "unreachable" };
    const botEntry = listRegistered()[name];
    const headers: Record<string, string> = {};
    if (botEntry?.botToken) headers["Authorization"] = `Bearer ${botEntry.botToken}`;
    const resp = await fetch(`${resolved.baseUrl}/api/status`, {
      headers,
      signal: AbortSignal.timeout(3000),
    });
    if (!resp.ok) return { busy: false, unknown: true, state: "unreachable" };
    const status = await resp.json() as { state?: string };
    const busyStates = ["thinking", "calling", "scheduled", "webhook"];
    return { busy: busyStates.includes(status.state ?? ""), state: status.state };
  } catch {
    return { busy: false, unknown: true, state: "unreachable" };
  }
}

export function safeError(c: Context, err: unknown) {
  log.error("Dashboard API error", { error: err instanceof Error ? err.message : String(err) });
  if (err instanceof MechaError) {
    return c.json({ error: err.message }, err.statusCode as 400);
  }
  return c.json({ error: "Internal server error" }, 500);
}

function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  const cookies = cookieHeader.split(";").map((part) => part.trim());
  for (const cookie of cookies) {
    const eq = cookie.indexOf("=");
    if (eq === -1) continue;
    const key = cookie.slice(0, eq).trim();
    if (key === name) return cookie.slice(eq + 1);
  }
  return undefined;
}

export function dashboardSessionCookie(): string {
  return `${DASHBOARD_COOKIE}=${DASHBOARD_TOKEN}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`;
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function hasDashboardAccess(c: Context): boolean {
  const auth = c.req.header("authorization");
  if (auth && constantTimeEquals(auth, `Bearer ${DASHBOARD_TOKEN}`)) return true;
  const cookie = readCookie(c.req.header("cookie"), DASHBOARD_COOKIE);
  return cookie !== undefined && constantTimeEquals(cookie, DASHBOARD_TOKEN);
}

export function shouldBootstrapDashboardSession(c: Context): boolean {
  if (!(c.req.method === "GET" || c.req.method === "HEAD")) return false;
  if (c.req.path.startsWith("/api/")) return false;
  return readCookie(c.req.header("cookie"), DASHBOARD_COOKIE) !== DASHBOARD_TOKEN;
}

export async function guardBusy(c: Context, name: string, extra?: Record<string, unknown>): Promise<Response | null> {
  const force = c.req.query("force") === "true";
  if (force) return null;
  const { busy, unknown, state } = await checkBotBusy(name);
  if (busy || unknown) {
    return c.json({
      error: unknown ? "Bot status unknown — use force=true to proceed" : "Bot is busy",
      code: unknown ? "BOT_STATUS_UNKNOWN" : "BOT_BUSY",
      state,
      ...extra,
    }, 409);
  }
  return null;
}
