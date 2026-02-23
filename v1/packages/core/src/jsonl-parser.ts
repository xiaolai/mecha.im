import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import type {
  JsonlEntry,
  JsonlUser,
  JsonlAssistant,
  ContentBlock,
  ParsedMessage,
  SessionSummary,
  ParsedSession,
} from "./jsonl-types.js";

const TITLE_MAX_LENGTH = 120;

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/** Returns the `.claude/projects` directory for a given mecha project path. */
export function resolveProjectsDir(mechaPath: string): string {
  return join(mechaPath, ".claude", "projects");
}

/** Lists project slug subdirectories under a `.claude/projects` dir. */
export function listProjectSlugs(projectsDir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(projectsDir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => {
      try {
        return statSync(join(projectsDir, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

// ---------------------------------------------------------------------------
// Session file discovery
// ---------------------------------------------------------------------------

export interface SessionFileInfo {
  filePath: string;
  sessionId: string;
  projectSlug: string;
  mtime: Date;
}

/**
 * Scans all project slug subdirs for `*.jsonl` session files.
 * Returns sorted by mtime descending (most recent first).
 */
export function listSessionFiles(projectsDir: string): SessionFileInfo[] {
  const slugs = listProjectSlugs(projectsDir);
  const files: SessionFileInfo[] = [];

  for (const slug of slugs) {
    const slugDir = join(projectsDir, slug);
    let entries: string[];
    try {
      entries = readdirSync(slugDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".jsonl")) continue;
      const filePath = join(slugDir, entry);
      try {
        const st = statSync(filePath);
        if (!st.isFile()) continue;
        files.push({
          filePath,
          sessionId: basename(entry, ".jsonl"),
          projectSlug: slug,
          mtime: st.mtime,
        });
      } catch {
        continue;
      }
    }
  }

  files.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  return files;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function extractTextFromContent(content: ContentBlock[] | string): string {
  if (typeof content === "string") return content;
  const texts: string[] = [];
  for (const block of content) {
    if (block.type === "text") texts.push(block.text);
  }
  return texts.join("\n");
}

function truncate(text: string, max: number): string {
  const single = text.replace(/\n/g, " ").trim();
  if (single.length <= max) return single;
  return single.slice(0, max - 1) + "\u2026";
}

function parseLine(line: string): JsonlEntry | null {
  try {
    return JSON.parse(line) as JsonlEntry;
  } catch {
    return null;
  }
}

function isUser(entry: JsonlEntry): entry is JsonlUser {
  return entry.type === "user";
}

function isAssistant(entry: JsonlEntry): entry is JsonlAssistant {
  return entry.type === "assistant";
}

// ---------------------------------------------------------------------------
// Summary (fast — reads first user msg + counts)
// ---------------------------------------------------------------------------

/**
 * Parse a session JSONL file into a lightweight summary.
 * Only reads enough to extract the title and counts messages.
 */
export function parseSessionSummary(filePath: string): SessionSummary {
  const raw = readFileSync(filePath, "utf-8");
  const sessionId = basename(filePath, ".jsonl");
  const parts = filePath.split("/");
  const projectSlug = parts[parts.length - 2]!;

  let title = "";
  let messageCount = 0;
  let model: string | undefined;
  let createdAt: Date | undefined;
  let updatedAt: Date | undefined;

  const lines = raw.split("\n");
  for (const line of lines) {
    if (!line) continue;
    const entry = parseLine(line);
    if (!entry) continue;

    if (isUser(entry)) {
      messageCount++;
      if (!title) {
        title = truncate(extractTextFromContent(entry.message.content), TITLE_MAX_LENGTH);
      }
      const ts = new Date(entry.timestamp);
      if (!createdAt) createdAt = ts;
      updatedAt = ts;
    } else if (isAssistant(entry)) {
      messageCount++;
      if (entry.message.model) model = entry.message.model;
      const ts = new Date(entry.timestamp);
      if (!createdAt) createdAt = ts;
      updatedAt = ts;
    }
  }

  const now = new Date();
  return {
    id: sessionId,
    projectSlug,
    title: title || "(untitled)",
    messageCount,
    model,
    createdAt: createdAt ?? now,
    updatedAt: updatedAt ?? now,
  };
}

// ---------------------------------------------------------------------------
// Full parse
// ---------------------------------------------------------------------------

function toContentBlocks(content: ContentBlock[] | string): ContentBlock[] {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  return content;
}

/** Parse a session JSONL file into a full session with all messages. */
export function parseSessionFile(filePath: string): ParsedSession {
  const raw = readFileSync(filePath, "utf-8");
  const sessionId = basename(filePath, ".jsonl");
  const parts = filePath.split("/");
  const projectSlug = parts[parts.length - 2]!;

  const messages: ParsedMessage[] = [];
  let title = "";
  let model: string | undefined;
  let createdAt: Date | undefined;
  let updatedAt: Date | undefined;

  const lines = raw.split("\n");
  for (const line of lines) {
    if (!line) continue;
    const entry = parseLine(line);
    if (!entry) continue;

    if (isUser(entry)) {
      const ts = new Date(entry.timestamp);
      if (!createdAt) createdAt = ts;
      updatedAt = ts;
      if (!title) {
        title = truncate(extractTextFromContent(entry.message.content), TITLE_MAX_LENGTH);
      }
      messages.push({
        uuid: entry.uuid,
        parentUuid: entry.parentUuid,
        role: "user",
        content: toContentBlocks(entry.message.content),
        timestamp: ts,
      });
    } else if (isAssistant(entry)) {
      const ts = new Date(entry.timestamp);
      if (!createdAt) createdAt = ts;
      updatedAt = ts;
      if (entry.message.model) model = entry.message.model;
      const parsed: ParsedMessage = {
        uuid: entry.uuid,
        parentUuid: entry.parentUuid,
        role: "assistant",
        content: entry.message.content,
        timestamp: ts,
      };
      if (entry.message.model) parsed.model = entry.message.model;
      if (entry.message.usage) {
        parsed.usage = {
          inputTokens: entry.message.usage.input_tokens,
          outputTokens: entry.message.usage.output_tokens,
          cacheReadTokens: entry.message.usage.cache_read_input_tokens,
          cacheCreationTokens: entry.message.usage.cache_creation_input_tokens,
        };
      }
      messages.push(parsed);
    }
  }

  const now = new Date();
  return {
    id: sessionId,
    projectSlug,
    title: title || "(untitled)",
    messageCount: messages.length,
    model,
    createdAt: createdAt ?? now,
    updatedAt: updatedAt ?? now,
    messages,
  };
}
