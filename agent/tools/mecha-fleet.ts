/**
 * Fleet management MCP tools for orchestrator bots.
 * Only registered when config.permissions.fleet_control is true.
 * All operations proxy to the daemon's /api/fleet/* endpoints.
 */

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const FLEET_URL = process.env.MECHA_FLEET_URL;
const FLEET_SECRET = process.env.MECHA_FLEET_INTERNAL_SECRET;
const BOT_NAME = process.env.MECHA_BOT_NAME;

// Rate limiting (in-memory, best-effort)
let spawnCount = 0;
let opsCount = 0;
let lastReset = Date.now();
const MAX_SPAWNS_PER_HOUR = 5;
const MAX_OPS_PER_HOUR = 20;

function checkRateLimit(isSpawn: boolean): string | null {
  const now = Date.now();
  if (now - lastReset > 3600_000) { spawnCount = 0; opsCount = 0; lastReset = now; }
  opsCount++;
  if (isSpawn) spawnCount++;
  if (spawnCount > MAX_SPAWNS_PER_HOUR) return `Spawn rate limit exceeded (max ${MAX_SPAWNS_PER_HOUR}/hour)`;
  if (opsCount > MAX_OPS_PER_HOUR) return `Fleet operation rate limit exceeded (max ${MAX_OPS_PER_HOUR}/hour)`;
  return null;
}

async function fleetApi(path: string, method = "GET", body?: unknown): Promise<unknown> {
  if (!FLEET_URL || !FLEET_SECRET) throw new Error("Fleet API not configured (MECHA_FLEET_URL not set)");
  const headers: Record<string, string> = { "Authorization": `Bearer ${FLEET_SECRET}` };
  if (body) headers["Content-Type"] = "application/json";
  const resp = await fetch(`${FLEET_URL}/api/fleet${path}`, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Fleet API error ${resp.status}: ${text}`);
  try { return JSON.parse(text); } catch { return text; }
}

function textResult(data: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
}

export function createFleetTools() {
  return [
    tool(
      "mecha_fleet_ls",
      "List all bots in the fleet with status, model, uptime, and cost.",
      {},
      async () => {
        const limit = checkRateLimit(false);
        if (limit) return textResult({ error: limit });
        const data = await fleetApi("/bots");
        return textResult(data);
      },
    ),

    tool(
      "mecha_fleet_spawn",
      "Spawn a new bot in the fleet.",
      {
        name: z.string().min(1).max(32).describe("Bot name"),
        system: z.string().min(1).describe("System prompt"),
        model: z.string().optional().describe("Model (default: sonnet)"),
        auth: z.string().optional().describe("Auth profile name"),
      },
      async (args) => {
        const limit = checkRateLimit(true);
        if (limit) return textResult({ error: limit });
        const data = await fleetApi("/bots", "POST", args);
        return textResult(data);
      },
    ),

    tool(
      "mecha_fleet_stop",
      "Stop a running bot.",
      { name: z.string().min(1).max(32).describe("Bot name to stop") },
      async (args) => {
        if (args.name === BOT_NAME) return textResult({ error: "Cannot stop self" });
        const limit = checkRateLimit(false);
        if (limit) return textResult({ error: limit });
        const data = await fleetApi(`/bots/${encodeURIComponent(args.name)}/stop`, "POST");
        return textResult(data);
      },
    ),

    tool(
      "mecha_fleet_start",
      "Start a stopped bot.",
      { name: z.string().min(1).max(32).describe("Bot name to start") },
      async (args) => {
        const limit = checkRateLimit(false);
        if (limit) return textResult({ error: limit });
        const data = await fleetApi(`/bots/${encodeURIComponent(args.name)}/start`, "POST");
        return textResult(data);
      },
    ),

    tool(
      "mecha_fleet_restart",
      "Restart a running bot.",
      { name: z.string().min(1).max(32).describe("Bot name to restart") },
      async (args) => {
        if (args.name === BOT_NAME) return textResult({ error: "Cannot restart self" });
        const limit = checkRateLimit(false);
        if (limit) return textResult({ error: limit });
        const data = await fleetApi(`/bots/${encodeURIComponent(args.name)}/restart`, "POST");
        return textResult(data);
      },
    ),

    tool(
      "mecha_fleet_rm",
      "Remove a bot from the fleet (stops and deletes).",
      { name: z.string().min(1).max(32).describe("Bot name to remove") },
      async (args) => {
        if (args.name === BOT_NAME) return textResult({ error: "Cannot remove self" });
        const limit = checkRateLimit(false);
        if (limit) return textResult({ error: limit });
        const data = await fleetApi(`/bots/${encodeURIComponent(args.name)}`, "DELETE");
        return textResult(data);
      },
    ),

    tool(
      "mecha_fleet_costs",
      "Get cost breakdown for the fleet or a specific bot.",
      {
        name: z.string().optional().describe("Bot name (omit for fleet total)"),
        period: z.enum(["today", "week", "month"]).optional().describe("Time period"),
      },
      async (args) => {
        const limit = checkRateLimit(false);
        if (limit) return textResult({ error: limit });
        const path = args.name ? `/costs/${encodeURIComponent(args.name)}` : "/costs";
        const query = args.period ? `?period=${args.period}` : "";
        const data = await fleetApi(`${path}${query}`);
        return textResult(data);
      },
    ),

    tool(
      "mecha_fleet_config",
      "View a bot's configuration (read-only).",
      {
        name: z.string().min(1).max(32).describe("Bot name"),
        field: z.string().optional().describe("Specific field to retrieve"),
      },
      async (args) => {
        const limit = checkRateLimit(false);
        if (limit) return textResult({ error: limit });
        const query = args.field ? `?field=${encodeURIComponent(args.field)}` : "";
        const data = await fleetApi(`/bots/${encodeURIComponent(args.name)}/config${query}`);
        return textResult(data);
      },
    ),

    tool(
      "mecha_fleet_status",
      "Get fleet health summary (running bots, costs, version).",
      {},
      async () => {
        const limit = checkRateLimit(false);
        if (limit) return textResult({ error: limit });
        const data = await fleetApi("/health");
        return textResult(data);
      },
    ),
  ];
}
