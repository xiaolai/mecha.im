/**
 * T4: Config & Auth module tests
 * Run: npx tsx test/t4-config-auth.ts
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { stringify as stringifyYaml } from "yaml";

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

console.log("--- T4: Config & Auth ---\n");

const { loadBotConfig, buildInlineConfig } = await import("../src/config.js");
const { botConfigSchema } = await import("../agent/types.js");

const TMP = join(tmpdir(), `mecha-t4-${randomBytes(4).toString("hex")}`);
mkdirSync(TMP, { recursive: true });

// T4.1 loadBotConfig valid YAML
await test("T4.1 loadBotConfig valid YAML", () => {
  const path = join(TMP, "valid.yaml");
  writeFileSync(path, stringifyYaml({
    name: "test-bot",
    system: "You are a test bot",
    model: "sonnet",
  }));
  const config = loadBotConfig(path);
  assert.equal(config.name, "test-bot");
  assert.equal(config.model, "sonnet");
  assert.equal(config.max_turns, 25); // default
});

// T4.2 loadBotConfig invalid YAML — YAML is extremely lenient, "{{{{...}}}}" parses as a mapping
// So we test with truly unparseable content (tab indentation issues)
await test("T4.2 loadBotConfig invalid input throws", () => {
  const path = join(TMP, "invalid.yaml");
  writeFileSync(path, "{{{{not yaml at all!!!!}}}}");
  // This actually parses as valid YAML (a nested flow mapping) then fails schema validation
  assert.throws(() => loadBotConfig(path));
});

// T4.3 loadBotConfig schema violation
await test("T4.3 loadBotConfig schema violation", () => {
  const path = join(TMP, "bad-schema.yaml");
  writeFileSync(path, stringifyYaml({
    name: "test-bot",
    // missing required 'system' field
  }));
  assert.throws(() => loadBotConfig(path));
});

// T4.4 buildInlineConfig defaults
await test("T4.4 buildInlineConfig defaults", () => {
  const config = buildInlineConfig({
    name: "inline-bot",
    system: "You are inline",
  });
  assert.equal(config.name, "inline-bot");
  assert.equal(config.model, "sonnet"); // default
  assert.equal(config.max_turns, 25);
  assert.equal(config.permission_mode, "default");
});

// T4.5 buildInlineConfig with custom model
await test("T4.5 buildInlineConfig custom model", () => {
  const config = buildInlineConfig({
    name: "custom-bot",
    system: "You are custom",
    model: "opus",
  });
  assert.equal(config.model, "opus");
});

// T4.6 botConfigSchema validates all fields
await test("T4.6 botConfigSchema full validation", () => {
  const result = botConfigSchema.safeParse({
    name: "full-bot",
    system: "Full system prompt",
    model: "sonnet",
    max_turns: 50,
    max_budget_usd: 1.0,
    permission_mode: "bypassPermissions",
    schedule: [{ cron: "0 9 * * *", prompt: "Wake up" }],
    webhooks: { accept: ["push", "pull_request"] },
  });
  assert.ok(result.success, `Validation failed: ${JSON.stringify(result.error?.issues)}`);
});

// T4.7 botConfigSchema rejects invalid cron
await test("T4.7 botConfigSchema rejects invalid cron", () => {
  const result = botConfigSchema.safeParse({
    name: "cron-bot",
    system: "Cron test",
    schedule: [{ cron: "not a cron", prompt: "Bad" }],
  });
  assert.equal(result.success, false);
});

// T4.8 botConfigSchema name validation
await test("T4.8 buildInlineConfig rejects bad name", () => {
  assert.throws(() => buildInlineConfig({
    name: "UPPER-case",
    system: "Bad name",
  }));
});

// T4.9 Config permission_mode enum
await test("T4.9 permission_mode enum values", () => {
  for (const mode of ["default", "acceptEdits", "bypassPermissions", "plan", "dontAsk"]) {
    const result = botConfigSchema.safeParse({
      name: "perm-bot",
      system: "test",
      permission_mode: mode,
    });
    assert.ok(result.success, `Mode "${mode}" should be valid`);
  }
  const bad = botConfigSchema.safeParse({
    name: "perm-bot",
    system: "test",
    permission_mode: "invalidMode",
  });
  assert.equal(bad.success, false);
});

rmSync(TMP, { recursive: true, force: true });

console.log(`\n--- T4 Results: ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);
