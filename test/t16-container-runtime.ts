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

console.log("--- T16: Container Runtime ---\n");

const { buildClaudeOptions } = await import("../agent/server.js");

const baseConfig = {
  name: "runtime-bot",
  system: "You are a runtime test bot",
  model: "sonnet",
  max_turns: 25,
  permission_mode: "default" as const,
  workspace_writable: false,
};

await test("T16.1 Workspace-less runtime uses state workspace and user settings only", () => {
  process.env.MECHA_WORKSPACE_CWD = "/state/workspace";
  process.env.MECHA_ENABLE_PROJECT_SETTINGS = "0";
  const options = buildClaudeOptions(baseConfig) as {
    cwd: string;
    settingSources: string[];
  };
  assert.equal(options.cwd, "/state/workspace");
  assert.deepEqual(options.settingSources, ["user"]);
});

await test("T16.2 Mounted workspace enables project settings", () => {
  process.env.MECHA_WORKSPACE_CWD = "/workspace";
  process.env.MECHA_ENABLE_PROJECT_SETTINGS = "1";
  const options = buildClaudeOptions(baseConfig) as {
    cwd: string;
    settingSources: string[];
  };
  assert.equal(options.cwd, "/workspace");
  assert.deepEqual(options.settingSources, ["user", "project"]);
});

await test("T16.3 bypassPermissions still requires explicit dangerous flag", () => {
  process.env.MECHA_WORKSPACE_CWD = "/workspace";
  process.env.MECHA_ENABLE_PROJECT_SETTINGS = "1";
  const options = buildClaudeOptions({
    ...baseConfig,
    permission_mode: "bypassPermissions",
  }) as {
    allowDangerouslySkipPermissions?: boolean;
  };
  assert.equal(options.allowDangerouslySkipPermissions, true);
});

console.log(`\n--- T16 Results: ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);
