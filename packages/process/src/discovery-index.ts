import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { writeFileSync, renameSync } from "node:fs";
import { type BotName, type DiscoveryIndex, type DiscoveryIndexEntry, readBotConfig } from "@mecha/core";
import { readState, writeState, listBotDirs } from "./state-store.js";
import type { ProcessEventEmitter } from "./events.js";
import { isPidAlive } from "./process-lifecycle.js";

/** Rebuild the discovery.json index from current bot state on disk. */
export function updateDiscoveryIndex(mechaDir: string, emitter: ProcessEventEmitter): void {
  try {
    const bots: DiscoveryIndexEntry[] = [];
    for (const dir of listBotDirs(mechaDir)) {
      const st = readState(dir);
      /* v8 ignore start -- defensive: state always exists for listBotDirs results */
      if (!st) continue;
      /* v8 ignore stop */
      const config = readBotConfig(dir);
      /* v8 ignore start -- defensive: config shape validation for tags/expose */
      const tags = Array.isArray(config?.tags) ? config.tags.filter((t): t is string => typeof t === "string") : [];
      const expose = Array.isArray(config?.expose) ? config.expose.filter((e): e is string => typeof e === "string") : [];
      /* v8 ignore stop */
      bots.push({ name: st.name, tags, expose, state: st.state });
    }
    const index: DiscoveryIndex = { version: 1, updatedAt: new Date().toISOString(), bots };
    const indexPath = join(mechaDir, "discovery.json");
    const tmp = indexPath + `.${randomBytes(4).toString("hex")}.tmp`;
    writeFileSync(tmp, JSON.stringify(index, null, 2) + "\n", { mode: 0o600 });
    renameSync(tmp, indexPath);
  /* v8 ignore start -- defensive: discovery index write failure should not crash lifecycle */
  } catch (err) {
    emitter.emit({ type: "warning", name: "_system" as BotName, message: `Failed to update discovery index: ${err instanceof Error ? err.message : String(err)}` });
  }
  /* v8 ignore stop */
}

/** On init, scan for existing state and mark dead processes as stopped. */
export function recoverState(mechaDir: string, emitter: ProcessEventEmitter): void {
  let changed = false;
  for (const botDir of listBotDirs(mechaDir)) {
    const state = readState(botDir);
    if (!state) continue;
    if (state.state === "running" && state.pid) {
      if (!isPidAlive(state.pid)) {
        state.state = "stopped";
        state.stoppedAt = new Date().toISOString();
        writeState(botDir, state);
        changed = true;
      }
    }
    /* v8 ignore start -- error state recovery: requires bot in error state with dead PID on disk at startup */
    if (state.state === "error" && state.pid) {
      if (!isPidAlive(state.pid)) {
        state.state = "stopped";
        state.stoppedAt = new Date().toISOString();
        writeState(botDir, state);
        changed = true;
      }
    }
    /* v8 ignore stop */
  }
  if (changed) updateDiscoveryIndex(mechaDir, emitter);
}
