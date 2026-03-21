import {
  AuthProfileNotFoundError,
  readAuthProfiles,
  readAuthCredentials,
} from "@mecha/core";
import type { AuthProfile } from "./auth.js";

function toPublicProfile(
  name: string,
  meta: { type: "oauth" | "api-key"; account: string | null; label: string; tags: string[]; expiresAt: number | null; createdAt: string },
  defaultName: string | null,
): AuthProfile {
  return {
    name,
    type: meta.type,
    account: meta.account,
    label: meta.label,
    isDefault: name === defaultName,
    tags: meta.tags,
    expiresAt: meta.expiresAt,
    createdAt: meta.createdAt,
  };
}

/** Test auth profile by probing the Anthropic API. */
/* v8 ignore start -- mechaAuthProbe makes real HTTP calls to Anthropic API */
export async function mechaAuthProbe(
  mechaDir: string,
  name: string,
): Promise<{ valid: boolean; error?: string; profile: AuthProfile }> {
  const store = readAuthProfiles(mechaDir);
  const meta = store.profiles[name];
  if (!meta) throw new AuthProfileNotFoundError(name);

  const creds = readAuthCredentials(mechaDir);
  const cred = creds[name];
  if (!cred || !cred.token) {
    return { valid: false, error: "missing credentials", profile: toPublicProfile(name, meta, store.default) };
  }

  const profile = toPublicProfile(name, meta, store.default);
  const headers: Record<string, string> = {
    "anthropic-version": "2023-06-01",
  };

  if (meta.type === "api-key") {
    headers["x-api-key"] = cred.token;
  } else {
    headers["Authorization"] = `Bearer ${cred.token}`;
  }

  try {
    const controller = new AbortController();
    /* v8 ignore start -- timeout callback only fires on network delay */
    const timeout = setTimeout(() => controller.abort(), 15_000);
    /* v8 ignore stop */
    let res: Response;
    try {
      res = await fetch("https://api.anthropic.com/v1/models", {
        method: "GET",
        headers,
        signal: controller.signal,
        redirect: "error",
      });
    } finally {
      clearTimeout(timeout);
    }
    /* v8 ignore start -- HTTP error responses depend on real API */
    if (!res.ok) {
      const transient = res.status === 429 || res.status >= 500;
      return { valid: false, error: `HTTP ${res.status}${transient ? " (transient)" : ""}`, profile };
    }
    /* v8 ignore stop */
    return { valid: true, profile };
  } catch (err) {
    /* v8 ignore start -- network error formatting */
    const msg = err instanceof Error ? err.message : "unknown error";
    return { valid: false, error: msg, profile };
    /* v8 ignore stop */
  }
}
/* v8 ignore stop */
