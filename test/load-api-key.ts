/**
 * Load ANTHROPIC_API_KEY from credentials.yaml (preferred) or .env (legacy).
 * Call this at the top of test files that need a real API key.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parse as parseYaml } from "yaml";

export function loadApiKey(): void {
  if (process.env.ANTHROPIC_API_KEY) return;

  const mechaDir = join(homedir(), ".mecha");

  // Try credentials.yaml first
  try {
    const raw = readFileSync(join(mechaDir, "credentials.yaml"), "utf-8");
    const data = parseYaml(raw) as { credentials?: Array<{ env: string; key: string }> };
    const cred = data.credentials?.find((c) => c.env === "ANTHROPIC_API_KEY");
    if (cred) {
      process.env.ANTHROPIC_API_KEY = cred.key;
      return;
    }
  } catch { /* fall through */ }

  // Fall back to .env
  try {
    const envFile = readFileSync(join(mechaDir, ".env"), "utf-8");
    const match = envFile.match(/^ANTHROPIC_API_KEY=(.+)$/m);
    if (match) process.env.ANTHROPIC_API_KEY = match[1].trim();
  } catch { /* ignore */ }
}
