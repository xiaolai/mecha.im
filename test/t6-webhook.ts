/**
 * T6: Webhook validation tests
 * Run: npx tsx test/t6-webhook.ts
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

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

console.log("--- T6: Webhook ---\n");

const { createWebhookRoutes } = await import("../agent/webhook.js");

const prompts: string[] = [];
const handler = async (prompt: string) => { prompts.push(prompt); return true; };

// T6.1 Valid GitHub push event accepted
await test("T6.1 Valid push event accepted", async () => {
  const webhookApp = createWebhookRoutes(
    { name: "test", system: "test", model: "sonnet", max_turns: 25, permission_mode: "default", workspace_writable: false, webhooks: { accept: ["push"] } },
    handler,
    () => false,
  );
  prompts.length = 0;
  const body = JSON.stringify({ ref: "refs/heads/main", repository: { full_name: "test/repo", html_url: "https://github.com/test/repo" }, sender: { login: "user" } });
  const res = await webhookApp.request("/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-github-event": "push",
    },
    body,
  });
  assert.equal(res.status, 200, `status: ${res.status}`);
  assert.ok(prompts.length > 0, "handler was called");
  assert.ok(prompts[0].includes("push"), "prompt mentions event type");
});

// T6.2 Unaccepted event → 204
await test("T6.2 Unaccepted event silently dropped", async () => {
  const webhookApp = createWebhookRoutes(
    { name: "test", system: "test", model: "sonnet", max_turns: 25, permission_mode: "default", workspace_writable: false, webhooks: { accept: ["push"] } },
    handler,
    () => false,
  );
  prompts.length = 0;
  const res = await webhookApp.request("/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-github-event": "issues",
    },
    body: JSON.stringify({ action: "opened" }),
  });
  assert.equal(res.status, 204);
  assert.equal(prompts.length, 0, "handler was NOT called");
});

// T6.3 HMAC signature validation
await test("T6.3 HMAC signature validation", async () => {
  const secret = "webhook-secret-123";
  const webhookApp = createWebhookRoutes(
    { name: "test", system: "test", model: "sonnet", max_turns: 25, permission_mode: "default", workspace_writable: false, webhooks: { accept: ["push"], secret } },
    handler,
    () => false,
  );

  const body = JSON.stringify({ ref: "refs/heads/main" });
  // Wrong signature
  const res1 = await webhookApp.request("/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-github-event": "push",
      "x-hub-signature-256": "sha256=bad",
    },
    body,
  });
  assert.equal(res1.status, 401, "bad sig rejected");

  // Missing signature when secret configured
  const res2 = await webhookApp.request("/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-github-event": "push",
    },
    body,
  });
  assert.equal(res2.status, 401, "missing sig rejected");

  // Valid signature
  const sig = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  const res3 = await webhookApp.request("/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-github-event": "push",
      "x-hub-signature-256": sig,
    },
    body,
  });
  assert.equal(res3.status, 200, "valid sig accepted");
});

// T6.4 Payload too large → 413
await test("T6.4 Payload too large", async () => {
  const webhookApp = createWebhookRoutes(
    { name: "test", system: "test", model: "sonnet", max_turns: 25, permission_mode: "default", workspace_writable: false, webhooks: { accept: ["push"] } },
    handler,
    () => false,
  );
  const bigBody = JSON.stringify({ data: "x".repeat(200_000) });
  const res = await webhookApp.request("/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-github-event": "push",
      "content-length": String(bigBody.length),
    },
    body: bigBody,
  });
  assert.equal(res.status, 413);
});

// T6.5 Bot busy → 429
await test("T6.5 Bot busy returns 429", async () => {
  const webhookApp = createWebhookRoutes(
    { name: "test", system: "test", model: "sonnet", max_turns: 25, permission_mode: "default", workspace_writable: false, webhooks: { accept: ["push"] } },
    handler,
    () => true, // isBusy = true
  );
  const body = JSON.stringify({ ref: "refs/heads/main", sender: { login: "user" } });
  const res = await webhookApp.request("/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-github-event": "push",
    },
    body,
  });
  assert.equal(res.status, 429);
});

console.log(`\n--- T6 Results: ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);
