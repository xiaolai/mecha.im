/**
 * Integration test harness — shared utilities for CLI + Dashboard API testing.
 *
 * Requires:
 *   - MECHA_OTP env var set to the TOTP base32 secret
 *   - Dashboard running locally (default: 127.0.0.1:3457)
 *   - CLI built (`pnpm build` in packages/cli)
 *   - For mesh tests: SSH access to remote nodes
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TOTP, Secret } from "otpauth";
import { isAuthBypassed } from "../src/lib/totp";
import { deriveSessionKey, createSessionToken } from "../src/lib/session";

// ---------------------------------------------------------------------------
// Load .env from project root (no dotenv dependency)
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "../../..");

function loadEnvFile(): void {
  try {
    const envPath = join(PROJECT_ROOT, ".env");
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      // Strip surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      // Only set if not already in env (env vars take precedence)
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env file doesn't exist — rely on env vars being set externally
  }
}

loadEnvFile();

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const DASH_HOST = process.env.DASH_HOST ?? "127.0.0.1";
export const DASH_PORT = parseInt(process.env.DASH_PORT ?? "3457", 10);
export const BASE_URL = `http://${DASH_HOST}:${DASH_PORT}`;
export const CLI_BIN = join(__dirname, "../../cli/dist/main.js");
export const CLI_TIMEOUT = 30_000;

// Mesh node IPs (mesh network)
export const MESH_NODES = {
  spark01: "100.100.1.5",
  "server-03": "100.100.1.3",
  linode02: "100.100.1.4",
} as const;

// ---------------------------------------------------------------------------
// TOTP
// ---------------------------------------------------------------------------

const BYPASS_FALLBACK_SECRET = "JBSWY3DPEHPK3PXP";

export function getOtpSecret(): string {
  const secret = process.env.MECHA_OTP;
  if (!secret) {
    if (isAuthBypassed()) return BYPASS_FALLBACK_SECRET;
    throw new Error("MECHA_OTP env var is required for integration tests");
  }
  return secret;
}

/** Generate a valid TOTP code for the current 30s window. */
export function generateTotp(): string {
  if (isAuthBypassed()) return "000000";
  const totp = new TOTP({
    issuer: "mecha",
    label: "dashboard",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(getOtpSecret()),
  });
  return totp.generate();
}

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

/** Create a JWT that is already expired (negative TTL). */
export function createExpiredToken(): string {
  const secret = process.env.MECHA_OTP ?? BYPASS_FALLBACK_SECRET;
  const key = deriveSessionKey(secret);
  return createSessionToken(key, -1);
}

/** Create a JWT signed with a wrong key (forged). */
export function createForgedToken(): string {
  const key = deriveSessionKey("WRONGSECRETBASE32AAAA");
  return createSessionToken(key, 24);
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

interface FetchOpts {
  method?: string;
  cookie?: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

async function dashFetch(path: string, opts: FetchOpts = {}): Promise<Response> {
  const { method = "GET", cookie, body, headers: extraHeaders, signal } = opts;
  const url = `${BASE_URL}${path}`;

  const headers: Record<string, string> = {
    ...extraHeaders,
  };

  if (cookie) {
    headers["Cookie"] = cookie;
  }

  // Add Origin header for non-GET requests (CSRF requirement)
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS" && !headers["Origin"]) {
    headers["Origin"] = BASE_URL;
  }

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  return fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });
}

/** Login and return the session cookie string (e.g. "mecha-session=<jwt>"). */
export async function dashLogin(host?: string, port?: number): Promise<string> {
  const base = host && port ? `http://${host}:${port}` : BASE_URL;
  const code = generateTotp();
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: base,
    },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    throw new Error(`Login failed: ${res.status} ${await res.text()}`);
  }
  const setCookie = res.headers.getSetCookie();
  const sessionCookie = setCookie.find((c) => c.startsWith("mecha-session="));
  if (!sessionCookie) {
    throw new Error("No mecha-session cookie in login response");
  }
  // Return just the name=value portion
  return sessionCookie.split(";")[0]!;
}

/** Authenticated GET request. */
export async function dashGet(
  path: string,
  cookie: string,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  return dashFetch(path, { cookie, headers: extraHeaders });
}

/** Authenticated POST request. */
export async function dashPost(
  path: string,
  cookie: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  return dashFetch(path, { method: "POST", cookie, body, headers: extraHeaders });
}

/** Authenticated DELETE request. */
export async function dashDelete(
  path: string,
  cookie: string,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  return dashFetch(path, { method: "DELETE", cookie, headers: extraHeaders });
}

/** Raw POST without Origin header (for CSRF testing). */
export async function dashPostNoOrigin(
  path: string,
  cookie: string,
  body?: unknown,
): Promise<Response> {
  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = {};
  if (cookie) headers["Cookie"] = cookie;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return fetch(url, {
    method: "POST",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/** POST with a custom Origin header (for CSRF testing). */
export async function dashPostCrossOrigin(
  path: string,
  cookie: string,
  origin: string,
  body?: unknown,
): Promise<Response> {
  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = {
    Origin: origin,
  };
  if (cookie) headers["Cookie"] = cookie;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return fetch(url, {
    method: "POST",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/** GET with a custom Host header (for DNS rebinding testing). */
export async function dashGetWithHost(
  path: string,
  hostHeader: string,
): Promise<Response> {
  const url = `${BASE_URL}${path}`;
  return fetch(url, {
    method: "GET",
    headers: { Host: hostHeader },
  });
}

/** Raw fetch for SSE streaming. Returns the Response for manual stream parsing. */
export async function dashSSE(
  cookie: string,
  signal?: AbortSignal,
): Promise<Response> {
  return dashFetch("/api/events", { cookie, signal });
}

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

/** Run a CLI command locally and return stdout. Throws on non-zero exit. */
export function cli(args: string): string {
  return execSync(`node ${CLI_BIN} ${args}`, {
    env: { ...process.env },
    timeout: CLI_TIMEOUT,
    encoding: "utf-8",
  }).trim();
}

/** Run a CLI command locally, returning { stdout, exitCode }. Does not throw. */
export function cliSafe(args: string): { stdout: string; exitCode: number } {
  try {
    const stdout = execSync(`node ${CLI_BIN} ${args}`, {
      env: { ...process.env },
      timeout: CLI_TIMEOUT,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return { stdout, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer | string; status?: number };
    const stdout = typeof e.stdout === "string" ? e.stdout : (e.stdout?.toString() ?? "");
    return { stdout: stdout.trim(), exitCode: e.status ?? 1 };
  }
}

/** Run a CLI command on a remote machine via SSH. */
export function remoteCli(sshTarget: string, args: string): string {
  return execSync(`ssh ${sshTarget} 'node ~/mecha.im/packages/cli/dist/main.js ${args}'`, {
    timeout: CLI_TIMEOUT,
    encoding: "utf-8",
  }).trim();
}

// ---------------------------------------------------------------------------
// SSE stream parser
// ---------------------------------------------------------------------------

/** Collect SSE events from a stream until timeout or abort. */
export async function collectSSEEvents(
  response: Response,
  timeoutMs: number = 5000,
): Promise<string[]> {
  const events: string[] = [];
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + timeoutMs;

  try {
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      const timer = new Promise<{ done: true; value: undefined }>((resolve) =>
        setTimeout(() => resolve({ done: true, value: undefined }), remaining),
      );
      const chunk = await Promise.race([reader.read(), timer]);
      if (chunk.done) break;
      const text = decoder.decode(chunk.value, { stream: true });
      // Split into lines and collect data/comment lines
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (trimmed) events.push(trimmed);
      }
    }
  } catch {
    // AbortError or timeout — expected
  } finally {
    try {
      reader.cancel();
    } catch {
      // ignore
    }
  }
  return events;
}

// ---------------------------------------------------------------------------
// Cleanup helpers
// ---------------------------------------------------------------------------

/** Kill a CASA by name, ignoring errors if it doesn't exist. */
export function cleanupCasa(name: string): void {
  try {
    execSync(`node ${CLI_BIN} kill ${name}`, {
      env: { ...process.env },
      timeout: CLI_TIMEOUT,
      stdio: "ignore",
    });
  } catch {
    // Already gone — fine
  }
}

/** Sleep for a given number of milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
