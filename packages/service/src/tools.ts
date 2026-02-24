import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
  const toolsDir = join(mechaDir, "tools");
  mkdirSync(toolsDir, { recursive: true });

  const info: ToolInfo = {
    name: opts.name,
    version: opts.version ?? "0.0.0",
    description: opts.description ?? "",
  };

  const toolDir = join(toolsDir, opts.name);
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
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as ToolInfo;
      tools.push(manifest);
    } catch {
      // skip malformed manifests
    }
  }

  return tools;
}
