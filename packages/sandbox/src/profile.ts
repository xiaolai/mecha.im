import { join, resolve, dirname } from "node:path";
import { existsSync, realpathSync } from "node:fs";
import type { BotConfig } from "@mecha/core";
import type { SandboxProfile } from "./types.js";

export interface ProfileFromConfigOpts {
  config: BotConfig;
  botDir: string;
  mechaDir: string;
  runtimeEntrypoint?: string;
}

/** Resolve symlinks and deduplicate paths. */
function dedup(paths: string[]): string[] {
  return [...new Set(paths.map((p) => {
    try { return realpathSync(p); } catch { return resolve(p); }
  }))];
}

/** Get the Node.js installation prefix (e.g. /usr/local or ~/.nvm/versions/node/vX). */
export function nodePrefix(): string {
  return resolve(dirname(dirname(process.execPath)));
}

/** Monorepo root markers (checked in order). */
const ROOT_MARKERS = ["pnpm-workspace.yaml", "pnpm-lock.yaml", "package-lock.json", "yarn.lock"];

/**
 * Find the monorepo/project root by walking up from a file.
 * Prefers monorepo root markers; falls back to the topmost dir with node_modules.
 */
export function findProjectRoot(startPath: string): string {
  let dir = resolve(dirname(startPath));
  const root = resolve("/");
  let topNodeModules: string | undefined;

  while (dir !== root) {
    // Prefer monorepo root markers
    for (const marker of ROOT_MARKERS) {
      if (existsSync(join(dir, marker))) {
        return dir;
      }
    }
    // Track the topmost node_modules as fallback
    if (existsSync(join(dir, "node_modules"))) {
      topNodeModules = dir;
    }
    dir = dirname(dir);
  }
  /* v8 ignore start -- fallback: no markers found */
  return topNodeModules ?? resolve(dirname(startPath));
  /* v8 ignore stop */
}

/**
 * Generate a SandboxProfile from bot config and paths.
 *
 * Read access: Node.js prefix (stdlib + binary), project root (for node_modules),
 *   discovery.json, botDir, workspace.
 * Write access: botDir (includes .claude/, logs/, tmp/), workspace.
 * Allowed processes: current node binary.
 * Network: defaults to true unless config.allowNetwork is explicitly false.
 */
export function profileFromConfig(opts: ProfileFromConfigOpts): SandboxProfile {
  const { config, botDir, mechaDir, runtimeEntrypoint } = opts;

  const readPaths: string[] = [
    // Node.js installation prefix — includes bin/, lib/, and internal modules
    nodePrefix(),
    resolve(join(mechaDir, "discovery.json")),
  ];
  if (runtimeEntrypoint) {
    // Include the project root (contains node_modules for dependency resolution)
    readPaths.push(findProjectRoot(runtimeEntrypoint));
  }
  readPaths.push(resolve(botDir));
  readPaths.push(resolve(config.workspace));

  // Explicit sub-paths needed: bwrap uses per-path --bind mounts, not subtree grants.
  const writePaths: string[] = [
    resolve(botDir),
    resolve(join(botDir, "logs")),
    resolve(join(botDir, "tmp")),
    resolve(config.workspace),
  ];

  const allowedProcesses: string[] = [
    resolve(process.execPath),
  ];

  return {
    readPaths: dedup(readPaths),
    writePaths: dedup(writePaths),
    allowedProcesses: dedup(allowedProcesses),
    allowNetwork: config.allowNetwork !== false,
  };
}
