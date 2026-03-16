/**
 * Shared helper for making authenticated API calls to a bot's container.
 * Used by config, sessions, costs, schedule, and webhooks CLI commands.
 */

import { getBot } from "../store.js";
import { resolveHostBotBaseUrl } from "../resolve-endpoint.js";

export interface BotApiOpts {
  method?: string;
  body?: unknown;
  timeout?: number;
}

export async function botApi(name: string, path: string, opts: BotApiOpts = {}): Promise<Response> {
  const botEntry = getBot(name);
  const resolved = await resolveHostBotBaseUrl(name);
  if (!resolved) {
    throw new Error(`Bot "${name}" not found or not reachable. Run "mecha ls" to see available bots.`);
  }

  const headers: Record<string, string> = {};
  if (botEntry?.botToken) headers["Authorization"] = `Bearer ${botEntry.botToken}`;
  if (opts.body) headers["Content-Type"] = "application/json";

  const resp = await fetch(`${resolved.baseUrl}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(opts.timeout ?? 10_000),
  });

  return resp;
}

/** Make API call and throw on non-OK response (no body parsing) */
export async function botApiChecked(name: string, path: string, opts: BotApiOpts = {}): Promise<Response> {
  const resp = await botApi(name, path, opts);
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Bot API error: ${resp.status} ${resp.statusText}${text ? ` — ${text}` : ""}`);
  }
  return resp;
}

/** Make API call, check response, parse JSON */
export async function botApiJson<T = unknown>(name: string, path: string, opts: BotApiOpts = {}): Promise<T> {
  const resp = await botApiChecked(name, path, opts);
  return resp.json() as Promise<T>;
}
