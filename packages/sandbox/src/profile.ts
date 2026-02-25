import { join, resolve } from "node:path";
import type { CasaConfig } from "@mecha/core";
import type { SandboxProfile } from "./types.js";

export interface ProfileFromConfigOpts {
  config: CasaConfig;
  casaDir: string;
  mechaDir: string;
  runtimeEntrypoint?: string;
}

/** Deduplicate an array of resolved paths. */
function dedup(paths: string[]): string[] {
  return [...new Set(paths)];
}

/**
 * Generate a SandboxProfile from CASA config and paths.
 *
 * Read access: node binary, runtime entrypoint, discovery.json (single file).
 * Write access: casaDir subdirs (home, logs, tmp), workspace.
 * Allowed processes: current node binary.
 * Network: defaults to true unless config.allowNetwork is explicitly false.
 */
export function profileFromConfig(opts: ProfileFromConfigOpts): SandboxProfile {
  const { config, casaDir, mechaDir, runtimeEntrypoint } = opts;

  const readPaths: string[] = [
    resolve(process.execPath),
    resolve(join(mechaDir, "discovery.json")),
  ];
  if (runtimeEntrypoint) {
    readPaths.push(resolve(runtimeEntrypoint));
  }
  readPaths.push(resolve(casaDir));
  readPaths.push(resolve(config.workspace));

  const writePaths: string[] = [
    resolve(join(casaDir, "home")),
    resolve(join(casaDir, "logs")),
    resolve(join(casaDir, "tmp")),
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
