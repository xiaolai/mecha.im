import { existsSync, readFileSync, openSync, readSync, closeSync, statSync, watchFile, unwatchFile } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { type BotName, BotNotFoundError } from "@mecha/core";
import { readState } from "./state-store.js";
import type { LogOpts } from "./types.js";

/**
 * Read logs from a bot's stdout.log and stderr.log.
 * Supports --tail (last N lines) and --follow (watch for changes).
 */
export function readLogs(
  botDir: string,
  name: BotName,
  logOpts?: LogOpts,
): Readable {
  const state = readState(botDir);
  if (!state) throw new BotNotFoundError(name);

  const stdoutPath = join(botDir, "logs", "stdout.log");
  const stderrPath = join(botDir, "logs", "stderr.log");
  const logPaths = [stdoutPath, stderrPath];

  // Read both stdout and stderr
  const parts: string[] = [];
  for (const logPath of logPaths) {
    if (existsSync(logPath)) {
      try { parts.push(readFileSync(logPath, "utf-8")); }
      /* v8 ignore start -- skip unreadable log files */
      catch { /* skip */ }
      /* v8 ignore stop */
    }
  }
  let content = parts.join("");

  // Apply --tail: keep only the last N lines
  if (content && logOpts?.tail) {
    const lines = content.split("\n");
    const hasTrailing = content.endsWith("\n");
    const meaningful = hasTrailing ? lines.slice(0, -1) : lines;
    const sliced = meaningful.slice(-logOpts.tail);
    content = sliced.join("\n") + (hasTrailing ? "\n" : "");
  }

  /* v8 ignore start -- follow mode uses watchFile, tested via CLI E2E integration */
  if (!logOpts?.follow) {
    if (!content) return Readable.from([]);
    return Readable.from([content]);
  }

  // --follow: push existing content then watch for changes
  const stream = new Readable({ read() {} });
  if (content) stream.push(content);

  // Track per-file offsets so changes in one file don't corrupt reads from the other
  const offsets = new Map<string, number>();
  for (const logPath of logPaths) {
    try { offsets.set(logPath, statSync(logPath).size); }
    catch { offsets.set(logPath, 0); }
  }

  const watcher = () => {
    for (const logPath of logPaths) {
      if (!existsSync(logPath)) continue;
      try {
        const st = statSync(logPath);
        const fileOffset = offsets.get(logPath) ?? 0;
        if (st.size > fileOffset) {
          const fd = openSync(logPath, "r");
          const buf = Buffer.alloc(st.size - fileOffset);
          readSync(fd, buf, 0, buf.length, fileOffset);
          closeSync(fd);
          stream.push(buf.toString("utf-8"));
          offsets.set(logPath, st.size);
        }
      } catch { /* skip */ }
    }
  };

  for (const logPath of logPaths) {
    watchFile(logPath, { interval: 500 }, watcher);
  }

  stream.on("close", () => {
    for (const logPath of logPaths) {
      unwatchFile(logPath, watcher);
    }
  });

  return stream;
  /* v8 ignore stop */
}
