import { readFileSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { getMechaDir, readSettings } from "./store.js";
import { atomicWriteText } from "../shared/atomic-write.js";
import { AuthProfileNotFoundError, AuthNotConfiguredError, InvalidNameError } from "../shared/errors.js";
import { log } from "../shared/logger.js";
import { isValidName } from "../shared/validation.js";

// --- Schema ---

export const credentialTypes = ["api_key", "oauth_token", "bot_token", "secret", "tailscale"] as const;

const credentialSchema = z.object({
  name: z.string().min(1),
  type: z.enum(credentialTypes),
  env: z.string().min(1),
  key: z.string().min(1),
  account: z.string().optional(),
  created_at: z.string().optional(),
  meta: z.record(z.string(), z.string()).optional(),
});

const credentialsFileSchema = z.object({
  credentials: z.array(credentialSchema).default([]),
});

export type Credential = z.infer<typeof credentialSchema>;
export type CredentialType = Credential["type"];

// --- Paths ---

function credentialsPath(): string {
  return join(getMechaDir(), "credentials.yaml");
}

// --- Read / Write ---

export function loadCredentials(): Credential[] {
  const path = credentialsPath();
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = parseYaml(raw);
    const result = credentialsFileSchema.safeParse(parsed);
    if (!result.success) {
      log.warn("credentials.yaml validation failed", { error: result.error.message });
      return [];
    }
    return result.data.credentials;
  } catch (err) {
    log.warn("Failed to read credentials.yaml", { error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

function saveCredentials(credentials: Credential[]): void {
  const path = credentialsPath();
  const content = stringifyYaml({ credentials }, { lineWidth: 0 });
  atomicWriteText(path, content);
  try { chmodSync(path, 0o600); } catch { /* best-effort */ }
}

// --- CRUD ---

export function getCredential(name: string): Credential {
  const creds = loadCredentials();
  const found = creds.find((c) => c.name === name);
  if (!found) throw new AuthProfileNotFoundError(name);
  return found;
}

export function listCredentials(): Credential[] {
  return loadCredentials();
}

export function addCredential(cred: Credential): void {
  if (!isValidName(cred.name)) throw new InvalidNameError(cred.name);
  const creds = loadCredentials();
  const idx = creds.findIndex((c) => c.name === cred.name);
  if (idx >= 0) {
    creds[idx] = cred;
  } else {
    creds.push(cred);
  }
  saveCredentials(creds);
}

export function removeCredential(name: string): boolean {
  const creds = loadCredentials();
  const idx = creds.findIndex((c) => c.name === name);
  if (idx < 0) return false;
  creds.splice(idx, 1);
  saveCredentials(creds);
  return true;
}

// --- Type detection from key prefix ---

export function detectCredentialType(key: string): { type: CredentialType; env: string } {
  if (key.startsWith("sk-ant-oat")) return { type: "oauth_token", env: "CLAUDE_CODE_OAUTH_TOKEN" };
  if (key.startsWith("sk-ant-api")) return { type: "api_key", env: "ANTHROPIC_API_KEY" };
  if (key.startsWith("tskey-"))     return { type: "tailscale", env: "MECHA_TS_AUTH_KEY" };
  if (key.startsWith("sk-"))        return { type: "api_key", env: "OPENAI_API_KEY" };
  if (key.startsWith("xai-"))       return { type: "api_key", env: "XAI_API_KEY" };
  if (key.startsWith("AIzaSy"))     return { type: "api_key", env: "GEMINI_API_KEY" };
  // Default: treat as generic secret
  return { type: "secret", env: "ANTHROPIC_API_KEY" };
}

// --- Auth resolution for Claude bots ---

export interface ResolvedAuth {
  key: string;
  env: string;
  source: string;
}

/**
 * Resolve auth credentials for a Claude bot.
 * Priority: explicit profile → default_auth setting → env vars.
 */
export function resolveAuth(profileName?: string): ResolvedAuth {
  // 1. Explicit profile name
  if (profileName) {
    const cred = getCredential(profileName);
    if (cred.type !== "api_key" && cred.type !== "oauth_token") {
      throw new AuthProfileNotFoundError(`"${profileName}" is not a Claude auth credential (type: ${cred.type})`);
    }
    return { key: cred.key, env: cred.env, source: `profile:${profileName}` };
  }

  // 2. Default auth from mecha settings
  const settings = readSettings();
  if (settings.default_auth) {
    try {
      const cred = getCredential(settings.default_auth);
      if (cred.type === "api_key" || cred.type === "oauth_token") {
        return { key: cred.key, env: cred.env, source: `default:${settings.default_auth}` };
      }
    } catch (err) {
      if (!(err instanceof AuthProfileNotFoundError)) throw err;
    }
  }

  // 3. Environment variables
  const oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (oauthToken) {
    return { key: oauthToken, env: "CLAUDE_CODE_OAUTH_TOKEN", source: "env:CLAUDE_CODE_OAUTH_TOKEN" };
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    return { key: apiKey, env: "ANTHROPIC_API_KEY", source: "env:ANTHROPIC_API_KEY" };
  }

  throw new AuthNotConfiguredError();
}

/**
 * Get all credentials that should be passed through to bot containers.
 * Returns credentials matching the given env var names.
 */
export function getPassthroughCredentials(envNames: string[]): Array<{ env: string; key: string }> {
  const creds = loadCredentials();
  const result: Array<{ env: string; key: string }> = [];
  for (const envName of envNames) {
    const cred = creds.find((c) => c.env === envName);
    if (cred) {
      result.push({ env: envName, key: cred.key });
    }
  }
  return result;
}

