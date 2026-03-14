#!/usr/bin/env npx tsx
/**
 * Generate fixture JSONL sessions for dashboard development.
 * Usage: npx tsx scripts/generate-fixtures.ts
 *
 * Creates sessions in .fixtures/sessions/ that cover every
 * rendering path in the conversation viewer.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import {
  ts,
  userLine,
  assistantLine,
  assistantStreamChunk,
  toolUseLine,
  toolResultLine,
  systemLine,
  progressLine,
  writeSession,
} from "./fixture-helpers.js";

import {
  MARKDOWN_SHOWCASE_USER_TEXT,
  MARKDOWN_SHOWCASE_ASSISTANT_TEXT,
  MARKDOWN_SHOWCASE_THINKING,
  TESTING_ANSWER,
  HALTING_PROBLEM_ANSWER,
  HALTING_PROBLEM_THINKING,
  TOOL_USE_SERVER_CONTENT,
  TOOL_USE_GREP_RESULT,
  TOOL_USE_GLOB_RESULT,
  TOOL_USE_TEST_RESULT,
  SECURITY_REVIEW_USER_TEXT,
  AUTH_FILE_CONTENT,
  TIMING_FIX_THINKING,
  AUTH_TEST_RESULT,
  TIMING_FIX_SUMMARY,
  LONG_CONVERSATION_TOPICS,
} from "./fixture-data.js";

const FIXTURES_DIR = join(import.meta.dirname, "..", ".fixtures", "sessions");
mkdirSync(FIXTURES_DIR, { recursive: true });

const write = (name: string, lines: object[]) => writeSession(FIXTURES_DIR, name, lines);

// ======================================================================
// Session 1: Markdown showcase (user + assistant both with rich markdown)
// ======================================================================

write("markdown-showcase", [
  progressLine(60),
  systemLine(60),

  userLine(MARKDOWN_SHOWCASE_USER_TEXT, 58),

  assistantLine(MARKDOWN_SHOWCASE_ASSISTANT_TEXT, 55, {
    thinking: MARKDOWN_SHOWCASE_THINKING,
    model: "claude-opus-4-6",
    tokensIn: 2400,
    tokensOut: 890,
  }),

  userLine("What about testing each layer independently?", 50),

  assistantLine(TESTING_ANSWER, 48, { tokensIn: 1800, tokensOut: 420 }),
]);

// ======================================================================
// Session 2: Heavy tool use — file reads, edits, bash commands
// ======================================================================

const tu1 = toolUseLine("Read", { file_path: "/app/src/server.ts" }, 45);
const tu2 = toolUseLine("Grep", { pattern: "handleRequest", path: "/app/src" }, 42);
const tu3 = toolUseLine("Bash", { command: "npm test -- --coverage" }, 39);
const tu4 = toolUseLine("Edit", {
  file_path: "/app/src/server.ts",
  old_string: "app.get('/health'",
  new_string: "app.get('/healthz'",
}, 37);
const tu5 = toolUseLine("Glob", { pattern: "**/*.test.ts" }, 36);

write("tool-use-heavy", [
  systemLine(46),
  userLine("Fix the health endpoint — it should be /healthz not /health. Run the tests after.", 46),

  // Streaming chunk (should be skipped by parser)
  assistantStreamChunk("Let me", 45.5),
  assistantStreamChunk("Let me look at the server", 45.3),

  tu1.line,
  toolResultLine(tu1.id, TOOL_USE_SERVER_CONTENT, 44),

  tu2.line,
  toolResultLine(tu2.id, TOOL_USE_GREP_RESULT, 41),

  tu4.line,
  toolResultLine(tu4.id, "File edited successfully.", 37),

  tu5.line,
  toolResultLine(tu5.id, TOOL_USE_GLOB_RESULT, 35.5),

  tu3.line,
  toolResultLine(tu3.id, TOOL_USE_TEST_RESULT, 34),

  assistantLine(
    `Renamed \`/health\` → \`/healthz\` in \`server.ts\`. Tests show one unrelated failure in \`api.test.ts\` (POST /api/data returns 404). The health endpoint tests pass.\n\nThe failing test looks pre-existing — not related to this change. Want me to investigate it?`,
    33,
    { tokensIn: 3200, tokensOut: 280 },
  ),
]);

// ======================================================================
// Session 3: Thinking-heavy session (opus with extended thinking)
// ======================================================================

write("thinking-heavy", [
  systemLine(30),

  userLine("Explain the halting problem and why it matters for static analysis tools.", 30),

  assistantLine(HALTING_PROBLEM_ANSWER, 27, {
    thinking: HALTING_PROBLEM_THINKING,
    model: "claude-opus-4-6",
    tokensIn: 800,
    tokensOut: 650,
  }),
]);

// ======================================================================
// Session 4: Minimal / edge case session
// ======================================================================

write("minimal-session", [
  systemLine(120),
  userLine("hello", 120),
  assistantLine("Hello! How can I help you today?", 119, { tokensIn: 50, tokensOut: 12 }),
]);

// ======================================================================
// Session 5: Long conversation with many turns
// ======================================================================

const longLines: object[] = [systemLine(180)];
let min = 175;
for (const { q, a } of LONG_CONVERSATION_TOPICS) {
  longLines.push(userLine(q, min));
  min -= 3;
  longLines.push(assistantLine(a, min, { tokensIn: 1000 + Math.floor(Math.random() * 2000), tokensOut: 200 + Math.floor(Math.random() * 400) }));
  min -= 2;
}

write("long-conversation", longLines);

// ======================================================================
// Session 6: Mixed — markdown user, tool use, thinking, code blocks
// ======================================================================

const mixTu1 = toolUseLine("Read", { file_path: "/app/src/auth.ts" }, 18);
const mixTu2 = toolUseLine("Edit", {
  file_path: "/app/src/auth.ts",
  old_string: "if (token === secret)",
  new_string: "if (timingSafeEqual(Buffer.from(token), Buffer.from(secret)))",
}, 15);
const mixTu3 = toolUseLine("Bash", { command: "npm test -- auth.test.ts" }, 13);

write("mixed-complete", [
  systemLine(20),

  userLine(SECURITY_REVIEW_USER_TEXT, 20),

  mixTu1.line,
  toolResultLine(mixTu1.id, AUTH_FILE_CONTENT, 17),

  assistantLine(
    `Found the timing vulnerability at line 7. The \`===\` comparison short-circuits, making it vulnerable to timing attacks. Fixing now.`,
    16,
    {
      thinking: TIMING_FIX_THINKING,
      model: "claude-opus-4-6",
      tokensIn: 1800,
      tokensOut: 180,
    },
  ),

  mixTu2.line,
  toolResultLine(mixTu2.id, "File edited successfully.", 14),

  mixTu3.line,
  toolResultLine(mixTu3.id, AUTH_TEST_RESULT, 12),

  assistantLine(TIMING_FIX_SUMMARY, 11, { tokensIn: 2200, tokensOut: 320 }),
]);

// ======================================================================
// Session 7: Empty/system-only (edge case — should be skipped by list)
// ======================================================================

write("empty-system-only", [
  systemLine(200),
  progressLine(200),
  { type: "file-history-snapshot", snapshot: {}, timestamp: ts(200) },
]);

console.log(`\nFixtures written to: ${FIXTURES_DIR}`);
console.log("Use with: MECHA_WORKSPACE_CWD=<path> or dev:mock mode");
