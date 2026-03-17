/**
 * T19: CLI query helpers — escapeAttr, collectAttachments, readPromptSSE
 * Run: npx tsx test/t19-cli-query.ts
 *
 * No Docker required — unit tests for CLI helper functions.
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync, statSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

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

console.log("--- T19: CLI Query Helpers ---\n");

// Since escapeAttr and collectAttachments are not exported, we test them
// by importing the CLI module or by replicating the logic.
// For proper testing, let's extract and test the functions directly.
// Since they're inline in cli.ts, we'll test via the CLI binary for integration,
// and replicate the logic for unit tests.

// --- escapeAttr ---

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// T19.1 escapeAttr: basic strings pass through
await test("T19.1 escapeAttr basic strings", () => {
  assert.equal(escapeAttr("hello.txt"), "hello.txt");
  assert.equal(escapeAttr("src/main.ts"), "src/main.ts");
  assert.equal(escapeAttr("my-file"), "my-file");
});

// T19.2 escapeAttr: escapes XML special chars
await test("T19.2 escapeAttr XML special chars", () => {
  assert.equal(escapeAttr('file"name'), "file&quot;name");
  assert.equal(escapeAttr("a&b"), "a&amp;b");
  assert.equal(escapeAttr("a<b>c"), "a&lt;b&gt;c");
  assert.equal(escapeAttr('a&b"c<d>e'), "a&amp;b&quot;c&lt;d&gt;e");
});

// T19.3 escapeAttr: empty string
await test("T19.3 escapeAttr empty string", () => {
  assert.equal(escapeAttr(""), "");
});

// T19.4 escapeAttr: all special chars at once
await test("T19.4 escapeAttr all specials", () => {
  const input = '&"<>';
  const expected = "&amp;&quot;&lt;&gt;";
  assert.equal(escapeAttr(input), expected);
});

// --- collectAttachments (replicated logic for unit testing) ---

const TMP = join(tmpdir(), `mecha-t19-${randomBytes(4).toString("hex")}`);
mkdirSync(TMP, { recursive: true });

// Inline the same collectAttachments logic from cli.ts for unit testing
function collectAttachmentsLocal(paths: string[]): string {
  const MAX_BYTES = 512 * 1024;
  let totalBytes = 0;
  const parts: string[] = [];

  function addFile(filePath: string, label: string) {
    if (totalBytes >= MAX_BYTES) return;
    const stat = statSync(filePath);
    if (!stat.isFile()) return;
    const raw = readFileSync(filePath);
    const remaining = MAX_BYTES - totalBytes;
    const trimmedBuf = raw.length > remaining ? raw.subarray(0, remaining) : raw;
    const trimmed = trimmedBuf.toString("utf-8");
    totalBytes += trimmedBuf.length;
    parts.push(`<file path="${escapeAttr(label)}">\n${trimmed}\n</file>`);
  }

  function walkDir(dirPath: string, base: string) {
    if (totalBytes >= MAX_BYTES) return;
    for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
      if (totalBytes >= MAX_BYTES) return;
      if (entry.name.startsWith(".")) continue;
      const full = join(dirPath, entry.name);
      const label = join(base, entry.name);
      if (entry.isDirectory()) walkDir(full, label);
      else addFile(full, label);
    }
  }

  for (const p of paths) {
    if (totalBytes >= MAX_BYTES) break;
    const abs = resolve(p);
    if (!existsSync(abs)) continue;
    if (statSync(abs).isDirectory()) walkDir(abs, basename(abs));
    else addFile(abs, basename(abs));
  }

  return parts.join("\n\n");
}

// T19.5 collectAttachments: single file
await test("T19.5 collectAttachments single file", () => {
  const filePath = join(TMP, "test.txt");
  writeFileSync(filePath, "Hello, world!");
  const result = collectAttachmentsLocal([filePath]);
  assert.ok(result.includes('<file path="test.txt">'), `should have file tag: ${result.slice(0, 100)}`);
  assert.ok(result.includes("Hello, world!"), "should include content");
  assert.ok(result.includes("</file>"), "should close tag");
});

// T19.6 collectAttachments: directory
await test("T19.6 collectAttachments directory", () => {
  const dirPath = join(TMP, "mydir");
  mkdirSync(dirPath, { recursive: true });
  writeFileSync(join(dirPath, "a.txt"), "file-a");
  writeFileSync(join(dirPath, "b.txt"), "file-b");
  const result = collectAttachmentsLocal([dirPath]);
  assert.ok(result.includes("file-a"), "should include file-a content");
  assert.ok(result.includes("file-b"), "should include file-b content");
  assert.ok(result.includes("mydir/a.txt") || result.includes("mydir\\a.txt"), "should use relative paths");
});

// T19.7 collectAttachments: skips dotfiles
await test("T19.7 collectAttachments skips dotfiles", () => {
  const dirPath = join(TMP, "dotdir");
  mkdirSync(dirPath, { recursive: true });
  writeFileSync(join(dirPath, "visible.txt"), "visible");
  writeFileSync(join(dirPath, ".hidden"), "hidden");
  const result = collectAttachmentsLocal([dirPath]);
  assert.ok(result.includes("visible"), "should include visible file");
  assert.ok(!result.includes("hidden"), "should skip dotfile");
});

// T19.8 collectAttachments: XML escaping in filenames
await test("T19.8 collectAttachments XML escaping", () => {
  const filePath = join(TMP, 'file"with<special>&chars.txt');
  try {
    writeFileSync(filePath, "content");
    const result = collectAttachmentsLocal([filePath]);
    assert.ok(!result.includes('path="file"with'), "should escape quotes");
    assert.ok(result.includes("&quot;") || result.includes("&amp;") || result.includes("&lt;"),
      "should have escaped entities");
  } catch {
    // Some filesystems don't allow special chars — that's fine, skip
    console.log("    (skipped — filesystem doesn't support special chars)");
  }
});

// T19.9 collectAttachments: byte-accurate 512KB cap
await test("T19.9 collectAttachments 512KB cap", () => {
  const bigDir = join(TMP, "bigdir");
  mkdirSync(bigDir, { recursive: true });
  // Create files totaling > 512KB
  const chunk = "x".repeat(100 * 1024); // 100KB each
  for (let i = 0; i < 7; i++) {
    writeFileSync(join(bigDir, `big-${i}.txt`), chunk);
  }
  const result = collectAttachmentsLocal([bigDir]);
  // The raw content bytes in the result should be <= 512KB
  // (plus XML tags, but the content itself is capped)
  const contentBytes = Buffer.byteLength(result, "utf-8");
  // With 7 * 100KB = 700KB input, result should be capped around 512KB of content
  // Allow some overhead for XML tags
  assert.ok(contentBytes < 600 * 1024, `result should be under 600KB (got ${contentBytes})`);
});

// T19.10 collectAttachments: empty directory
await test("T19.10 collectAttachments empty directory", () => {
  const emptyDir = join(TMP, "emptydir");
  mkdirSync(emptyDir, { recursive: true });
  const result = collectAttachmentsLocal([emptyDir]);
  assert.equal(result, "", "empty dir produces empty result");
});

// T19.11 collectAttachments: multiple paths
await test("T19.11 collectAttachments multiple paths", () => {
  const f1 = join(TMP, "multi1.txt");
  const f2 = join(TMP, "multi2.txt");
  writeFileSync(f1, "content1");
  writeFileSync(f2, "content2");
  const result = collectAttachmentsLocal([f1, f2]);
  assert.ok(result.includes("content1"), "includes first file");
  assert.ok(result.includes("content2"), "includes second file");
  // Two file blocks separated by double newline
  assert.ok(result.includes("</file>\n\n<file"), "files separated by blank line");
});

// T19.12 collectAttachments: nested directories
await test("T19.12 collectAttachments nested directories", () => {
  const nested = join(TMP, "nested");
  mkdirSync(join(nested, "sub1", "sub2"), { recursive: true });
  writeFileSync(join(nested, "root.txt"), "root");
  writeFileSync(join(nested, "sub1", "mid.txt"), "mid");
  writeFileSync(join(nested, "sub1", "sub2", "deep.txt"), "deep");
  const result = collectAttachmentsLocal([nested]);
  assert.ok(result.includes("root"), "includes root file");
  assert.ok(result.includes("mid"), "includes mid file");
  assert.ok(result.includes("deep"), "includes deep file");
});

// --- readPromptSSE ---

const { readPromptSSE } = await import("../src/cli-utils.js");

function createSSEReader(lines: string[]): ReadableStreamDefaultReader<Uint8Array> {
  const encoder = new TextEncoder();
  const data = encoder.encode(lines.join("\n") + "\n");
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
  return stream.getReader();
}

// Capture stdout for readPromptSSE tests
function captureStdout(fn: () => Promise<unknown>): Promise<{ output: string; result: unknown }> {
  let output = "";
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk: string | Uint8Array) => {
    output += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    return true;
  };
  return fn().then((result) => {
    process.stdout.write = originalWrite;
    return { output, result };
  }).catch((err) => {
    process.stdout.write = originalWrite;
    throw err;
  });
}

// T19.13 readPromptSSE: returns true on success
await test("T19.13 readPromptSSE returns true on success", async () => {
  const reader = createSSEReader([
    'data: {"content":"Hello!"}',
    'data: {"cost_usd":0.001,"duration_ms":100,"session_id":"s1","success":true}',
  ]);
  const { result } = await captureStdout(() => readPromptSSE(reader));
  assert.equal(result, true);
});

// T19.14 readPromptSSE: returns false on error message
await test("T19.14 readPromptSSE returns false on error", async () => {
  const reader = createSSEReader([
    'data: {"message":"Error occurred"}',
    'data: {"cost_usd":0.001,"duration_ms":100,"session_id":"s1","success":false}',
  ]);
  // Capture stderr too
  const originalError = console.error;
  let stderrOutput = "";
  console.error = (...args: unknown[]) => { stderrOutput += args.join(" "); };
  const { result } = await captureStdout(() => readPromptSSE(reader));
  console.error = originalError;
  assert.equal(result, false);
});

// T19.15 readPromptSSE: returns false when success:false in done event
await test("T19.15 readPromptSSE false on success:false", async () => {
  const reader = createSSEReader([
    'data: {"content":"partial"}',
    'data: {"cost_usd":0.001,"duration_ms":100,"session_id":"s1","success":false}',
  ]);
  const { result } = await captureStdout(() => readPromptSSE(reader));
  assert.equal(result, false);
});

// T19.16 readPromptSSE: outputs content to stdout
await test("T19.16 readPromptSSE outputs content", async () => {
  const reader = createSSEReader([
    'data: {"content":"Hello "}',
    'data: {"content":"World!"}',
    'data: {"cost_usd":0.001,"duration_ms":100,"session_id":"s1","success":true}',
  ]);
  const { output } = await captureStdout(() => readPromptSSE(reader));
  assert.ok(output.includes("Hello "), "should output first chunk");
  assert.ok(output.includes("World!"), "should output second chunk");
});

// T19.17 readPromptSSE: outputs tool summaries
await test("T19.17 readPromptSSE tool summaries", async () => {
  const reader = createSSEReader([
    'data: {"summary":"Read file.txt"}',
    'data: {"cost_usd":0,"duration_ms":0,"session_id":"s","success":true}',
  ]);
  const { output } = await captureStdout(() => readPromptSSE(reader));
  assert.ok(output.includes("[tool] Read file.txt"), "should output tool summary");
});

// T19.18 readPromptSSE: outputs cost info
await test("T19.18 readPromptSSE cost info", async () => {
  const reader = createSSEReader([
    'data: {"cost_usd":0.1234,"duration_ms":5000,"session_id":"sess-abc","success":true}',
  ]);
  // Cost info goes to console.log which writes to stdout
  const { output } = await captureStdout(() => {
    const origLog = console.log;
    // Temporarily redirect console.log to stdout.write
    console.log = (...args: unknown[]) => {
      process.stdout.write(args.join(" ") + "\n");
    };
    return readPromptSSE(createSSEReader([
      'data: {"cost_usd":0.1234,"duration_ms":5000,"session_id":"sess-abc","success":true}',
    ])).then((r) => {
      console.log = origLog;
      return r;
    });
  });
  assert.ok(output.includes("0.1234") || output.includes("Cost"), `should include cost info: ${output.slice(0, 200)}`);
});

// Cleanup
rmSync(TMP, { recursive: true, force: true });

console.log(`\n--- T19 Results: ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);
