import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { generateTOTP } from "../shared/totp.js";

// Isolated mecha dir — no TOTP secret yet
const TMP = join(tmpdir(), `mecha-t20-${randomBytes(4).toString("hex")}`);
mkdirSync(TMP, { recursive: true });
const origHome = process.env.MECHA_HOME;
process.env.MECHA_HOME = TMP;

// Use a known dashboard token
process.env.MECHA_DASHBOARD_TOKEN = "test-dashboard-token-t20";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}: ${err instanceof Error ? err.message : err}`);
    console.log(err);
    failed++;
  }
}

console.log("--- T20: TOTP Authentication ---\n");

const { startDashboardServer } = await import("../src/dashboard-server.js");

const port = 18200 + Math.floor(Math.random() * 400);
const server = startDashboardServer(port);
const baseUrl = `http://127.0.0.1:${port}`;

// Helper: fetch with auth token
function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...init?.headers as Record<string, string>,
      Authorization: "Bearer test-dashboard-token-t20",
    },
  });
}

try {
  // --- TOTP disabled (default) ---

  await test("T20.1 TOTP status returns disabled by default", async () => {
    const res = await fetch(`${baseUrl}/api/totp/status`);
    assert.equal(res.status, 200);
    const data = await res.json() as { enabled: boolean };
    assert.equal(data.enabled, false);
  });

  await test("T20.2 Root auto-sets session cookie when TOTP disabled", async () => {
    const res = await fetch(`${baseUrl}/`);
    const setCookie = res.headers.get("set-cookie");
    assert.ok(setCookie?.includes("mecha_dashboard_session="), "should bootstrap cookie");
  });

  await test("T20.3 Verify rejects when TOTP not enabled", async () => {
    const res = await fetch(`${baseUrl}/api/totp/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "123456" }),
    });
    assert.equal(res.status, 400);
  });

  // --- Enable TOTP ---

  let totpSecret = "";

  await test("T20.4 Enable TOTP", async () => {
    const res = await authedFetch("/api/totp/enable", { method: "POST" });
    assert.equal(res.status, 200);
    const data = await res.json() as { secret: string; uri: string };
    assert.ok(data.secret.length > 0, "should return secret");
    assert.ok(data.uri.startsWith("otpauth://totp/"), "should return otpauth URI");
    totpSecret = data.secret;
  });

  await test("T20.5 TOTP status returns enabled after setup", async () => {
    const res = await fetch(`${baseUrl}/api/totp/status`);
    const data = await res.json() as { enabled: boolean };
    assert.equal(data.enabled, true);
  });

  await test("T20.6 Enable again rejects (already enabled)", async () => {
    const res = await authedFetch("/api/totp/enable", { method: "POST" });
    assert.equal(res.status, 400);
  });

  await test("T20.7 Root does NOT auto-set session cookie when TOTP enabled", async () => {
    const res = await fetch(`${baseUrl}/`, {
      headers: {},  // no existing cookie
    });
    const setCookie = res.headers.get("set-cookie");
    assert.equal(setCookie, null, "should not bootstrap cookie when TOTP enabled");
  });

  // --- TOTP verification ---

  await test("T20.8 Verify rejects wrong code", async () => {
    const res = await fetch(`${baseUrl}/api/totp/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "000000" }),
    });
    assert.equal(res.status, 401);
  });

  await test("T20.9 Verify rejects malformed code", async () => {
    const res = await fetch(`${baseUrl}/api/totp/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "abc" }),
    });
    assert.equal(res.status, 400);
  });

  let sessionCookie = "";

  await test("T20.10 Verify accepts correct TOTP code and sets session", async () => {
    const code = generateTOTP(totpSecret);
    const res = await fetch(`${baseUrl}/api/totp/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    assert.equal(res.status, 200);
    const data = await res.json() as { authenticated: boolean };
    assert.equal(data.authenticated, true);
    const setCookie = res.headers.get("set-cookie");
    assert.ok(setCookie?.includes("mecha_dashboard_session="), "should set session cookie");
    sessionCookie = setCookie!.split(";")[0];
  });

  await test("T20.11 Session cookie from TOTP works for API access", async () => {
    const res = await fetch(`${baseUrl}/api/session`, {
      headers: { Cookie: sessionCookie },
    });
    assert.equal(res.status, 200);
  });

  await test("T20.12 API rejects without session or token when TOTP enabled", async () => {
    const res = await fetch(`${baseUrl}/api/session`);
    assert.equal(res.status, 401);
  });

  // --- Disable TOTP ---

  await test("T20.13 Disable rejects without code", async () => {
    const res = await authedFetch("/api/totp", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  });

  await test("T20.14 Disable rejects wrong code", async () => {
    const res = await authedFetch("/api/totp", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "000000" }),
    });
    assert.equal(res.status, 401);
  });

  await test("T20.15 Disable accepts correct code", async () => {
    const code = generateTOTP(totpSecret);
    const res = await authedFetch("/api/totp", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    assert.equal(res.status, 200);
    const data = await res.json() as { disabled: boolean };
    assert.equal(data.disabled, true);
  });

  await test("T20.16 TOTP status returns disabled after removal", async () => {
    const res = await fetch(`${baseUrl}/api/totp/status`);
    const data = await res.json() as { enabled: boolean };
    assert.equal(data.enabled, false);
  });

  await test("T20.17 Root auto-sets session cookie again after TOTP disabled", async () => {
    const res = await fetch(`${baseUrl}/`);
    const setCookie = res.headers.get("set-cookie");
    assert.ok(setCookie?.includes("mecha_dashboard_session="), "should bootstrap cookie again");
  });
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close((err?: Error) => err ? reject(err) : resolve());
  });
  if (origHome) process.env.MECHA_HOME = origHome;
  else delete process.env.MECHA_HOME;
  rmSync(TMP, { recursive: true, force: true });
}

console.log(`\n--- T20 Results: ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);
