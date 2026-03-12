import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

process.env.MECHA_DASHBOARD_TOKEN = "test-dashboard-token";

// Isolated credential store for dashboard credential tests
const CRED_TMP = join(tmpdir(), `mecha-t11-${randomBytes(4).toString("hex")}`);
mkdirSync(CRED_TMP, { recursive: true });
const origHome = process.env.MECHA_HOME;
process.env.MECHA_HOME = CRED_TMP;

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}: ${err instanceof Error ? err.message : err}`);
    failed++;
  }
}

console.log("--- T11: Fleet Dashboard Auth ---\n");

const { startDashboardServer } = await import("../src/dashboard-server.js");

const port = 17600 + Math.floor(Math.random() * 400);
const server = startDashboardServer(port);
const baseUrl = `http://127.0.0.1:${port}`;

try {
  await test("T11.1 API rejects without auth", async () => {
    const res = await fetch(`${baseUrl}/api/session`);
    assert.equal(res.status, 401);
  });

  let sessionCookie = "";

  await test("T11.2 Root bootstraps dashboard session cookie", async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.ok(res.ok, `root status ${res.status}`);
    const setCookie = res.headers.get("set-cookie");
    assert.ok(setCookie?.includes("mecha_dashboard_session="), `set-cookie: ${setCookie}`);
    sessionCookie = setCookie!.split(";")[0];
  });

  await test("T11.3 Session cookie authorizes API access", async () => {
    const res = await fetch(`${baseUrl}/api/session`, {
      headers: { Cookie: sessionCookie },
    });
    assert.equal(res.status, 200);
    const data = await res.json() as { authenticated: boolean };
    assert.equal(data.authenticated, true);
  });

  await test("T11.4 Session cookie reaches proxy routes", async () => {
    const res = await fetch(`${baseUrl}/bot/fake-bot/dashboard/`, {
      headers: { Cookie: sessionCookie },
    });
    assert.ok(res.status === 502 || res.status === 404, `status: ${res.status}`);
    assert.notEqual(res.status, 401);
  });

  // T11.5 POST /api/auth creates a credential via the new addCredential/detectCredentialType path
  await test("T11.5 POST /api/auth creates credential", async () => {
    const res = await fetch(`${baseUrl}/api/auth`, {
      method: "POST",
      headers: {
        Cookie: sessionCookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ profile: "test-key", key: "sk-ant-api03-dashboard-test" }),
    });
    assert.equal(res.status, 200);
    const data = await res.json() as { status: string; profile: string };
    assert.equal(data.status, "added");
    assert.equal(data.profile, "test-key");
  });

  // T11.6 GET /api/auth returns credential names from listCredentials
  await test("T11.6 GET /api/auth returns credential names", async () => {
    const res = await fetch(`${baseUrl}/api/auth`, {
      headers: { Cookie: sessionCookie },
    });
    assert.equal(res.status, 200);
    const data = await res.json() as string[];
    assert.ok(Array.isArray(data), "response is an array");
    assert.ok(data.includes("test-key"), `should contain "test-key", got: ${JSON.stringify(data)}`);
  });
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close((err?: Error) => err ? reject(err) : resolve());
  });
  if (origHome) process.env.MECHA_HOME = origHome;
  else delete process.env.MECHA_HOME;
  rmSync(CRED_TMP, { recursive: true, force: true });
}

console.log(`\n--- T11 Results: ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);
