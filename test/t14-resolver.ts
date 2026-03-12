import assert from "node:assert/strict";

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

console.log("--- T14: Resolver ---\n");

const { listHostBotEndpointCandidates, resolveHostBotBaseUrl } = await import("../src/resolve-endpoint.js");
const ghostName = "ghost-bot-never-created";

await test("T14.1 Remote candidate list includes MagicDNS", async () => {
  const candidates = await listHostBotEndpointCandidates(ghostName);
  assert.ok(candidates.some((candidate) => candidate.via === "magicdns"));
  assert.ok(candidates.some((candidate) => candidate.baseUrl === `http://mecha-${ghostName}:3000`));
});

await test("T14.2 Local-only resolution returns null for missing bot", async () => {
  const resolved = await resolveHostBotBaseUrl(ghostName, { allowRemote: false });
  assert.equal(resolved, null);
});

console.log(`\n--- T14 Results: ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);
