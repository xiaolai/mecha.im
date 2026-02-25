import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

/** CASA configuration persisted in config.json */
export interface CasaConfig {
  port: number;
  token: string;
  workspace: string;
  model?: string;
  permissionMode?: string;
  auth?: string;
  tags?: string[];
  expose?: string[];
}

function isCasaConfig(v: unknown): v is CasaConfig {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.port === "number" && typeof o.token === "string" && typeof o.workspace === "string";
}

/** Read a CASA's config.json. Returns undefined if missing or malformed. */
export function readCasaConfig(casaDir: string): CasaConfig | undefined {
  const configPath = join(casaDir, "config.json");
  if (!existsSync(configPath)) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(configPath, "utf-8"));
    if (!isCasaConfig(parsed)) return undefined;
    // Normalize tags and expose to string[] | undefined
    if (parsed.tags !== undefined && !Array.isArray(parsed.tags)) {
      parsed.tags = undefined;
    }
    if (parsed.expose !== undefined && !Array.isArray(parsed.expose)) {
      parsed.expose = undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

/**
 * Forward a query message to a CASA via HTTP. Shared by router and runtime mesh-tools.
 * Returns the response text.
 */
export async function forwardQueryToCasa(
  port: number,
  token: string,
  message: string,
): Promise<string> {
  const url = `http://127.0.0.1:${port}/api/chat`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ message }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    throw new Error(`Target returned HTTP ${response.status}`);
  }

  /* v8 ignore start -- content-type parsing branches */
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const data = (await response.json()) as Record<string, unknown>;
    return typeof data.response === "string" ? data.response : JSON.stringify(data);
  }
  return await response.text();
  /* v8 ignore stop */
}

/** Update fields in a CASA's config.json (read-modify-write, atomic). */
export function updateCasaConfig(
  casaDir: string,
  updates: Partial<CasaConfig>,
): void {
  const configPath = join(casaDir, "config.json");
  const existing = readCasaConfig(casaDir) ?? ({} as Partial<CasaConfig>);
  const merged = { ...existing, ...updates };
  const tmp = configPath + `.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, JSON.stringify(merged, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, configPath);
}
