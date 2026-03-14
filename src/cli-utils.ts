import { resolve, join, basename } from "node:path";
import { existsSync, statSync, readFileSync, readdirSync } from "node:fs";
import { isValidName } from "../shared/validation.js";

export function requireValidName(name: string): asserts name is string {
  if (!isValidName(name)) {
    console.error(`Invalid bot name: "${name}"`);
    process.exit(1);
  }
}

export function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function collectAttachments(paths: string[]): string {
  const MAX_BYTES = 512 * 1024; // 512KB total limit
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
    if (!existsSync(abs)) {
      console.error(`Attachment not found: ${abs}`);
      process.exit(1);
    }
    if (statSync(abs).isDirectory()) walkDir(abs, basename(abs));
    else addFile(abs, basename(abs));
  }

  if (totalBytes >= MAX_BYTES) {
    console.warn("Warning: attachments truncated at 512KB total");
  }
  return parts.join("\n\n");
}
