import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { atomicWriteSync } from "@mecha/core";

/** Parse JSONL file into array of objects. Skips corrupt lines. */
export function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const content = readFileSync(path, "utf-8").trim();
  if (!content) return [];
  const items: T[] = [];
  for (const line of content.split("\n")) {
    try {
      items.push(JSON.parse(line) as T);
    } catch {
      // Skip corrupt line — partial write from crash
    }
  }
  return items;
}

/** Write array of objects as JSONL file (atomic). */
export function writeJsonl<T>(path: string, items: T[]): void {
  const content = items.map((item) => JSON.stringify(item)).join("\n");
  atomicWriteSync(path, content ? content + "\n" : "");
}

/** Append a single object to a JSONL file. */
export function appendJsonl<T>(path: string, item: T): void {
  const line = JSON.stringify(item) + "\n";
  writeFileSync(path, line, { flag: "a" });
}
