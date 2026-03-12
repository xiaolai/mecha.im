import assert from "node:assert/strict";

process.env.MECHA_DASHBOARD_TOKEN = "test-dashboard-token";

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
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close((err?: Error) => err ? reject(err) : resolve());
  });
}

console.log(`\n--- T11 Results: ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);
