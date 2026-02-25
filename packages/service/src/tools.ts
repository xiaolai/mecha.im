import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";
import { InvalidToolNameError } from "@mecha/core";

export interface ToolInfo {
  name: string;
  version: string;
  description: string;
}

export interface ToolInstallOpts {
  name: string;
  version?: string;
  description?: string;
}

/**
 * Installs a tool (stub — writes a manifest file).
 * Full implementation will download/validate tool packages.
 */
export function mechaToolInstall(mechaDir: string, opts: ToolInstallOpts): ToolInfo {
  // Validate tool name — reject path separators and traversal
  if (!/^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/i.test(opts.name) || opts.name.includes("..")) {
    throw new InvalidToolNameError(opts.name);
  }

  const toolsDir = join(mechaDir, "tools");
  mkdirSync(toolsDir, { recursive: true });

  const info: ToolInfo = {
    name: opts.name,
    version: opts.version ?? "0.0.0",
    description: opts.description ?? "",
  };

  const toolDir = join(toolsDir, opts.name);
  // Double-check resolved path stays under toolsDir
  const rel = relative(resolve(toolsDir), resolve(toolDir));
  /* v8 ignore start -- defense-in-depth: regex above blocks traversal */
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new InvalidToolNameError(opts.name);
  }
  /* v8 ignore stop */
  mkdirSync(toolDir, { recursive: true });
  writeFileSync(join(toolDir, "manifest.json"), JSON.stringify(info, null, 2));

  return info;
}

/**
 * Lists installed tools.
 */
export function mechaToolLs(mechaDir: string): ToolInfo[] {
  const toolsDir = join(mechaDir, "tools");
  if (!existsSync(toolsDir)) return [];

  const entries = readdirSync(toolsDir, { withFileTypes: true });
  const tools: ToolInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(toolsDir, entry.name, "manifest.json");
    if (!existsSync(manifestPath)) continue;

    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Record<string, unknown>;
      if (typeof manifest.name !== "string" || typeof manifest.version !== "string" || typeof manifest.description !== "string") {
        console.error(`[mecha] Skipping invalid tool manifest (missing fields): ${manifestPath}`);
        continue;
      }
      tools.push({ name: manifest.name, version: manifest.version, description: manifest.description });
    } catch {
      console.error(`[mecha] Skipping malformed tool manifest: ${manifestPath}`);
    }
  }

  return tools;
}
