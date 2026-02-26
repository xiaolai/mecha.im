import { request as httpsRequest } from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { MeterEvent, PricingTable, BudgetConfig } from "./types.js";
import type { CasaRegistryEntry } from "./types.js";
import type { HotCounters } from "./hot-counters.js";
import { ingestEvent } from "./hot-counters.js";
import { parseSSEChunk, createSSEParseState, extractNonStreamUsage } from "./stream.js";
import { computeCost, resolvePricing } from "./pricing.js";
import { ulid } from "./ulid.js";
import { appendEvent } from "./events.js";
import { lookupCasa } from "./registry.js";
import { readBudgets, checkBudgets } from "./budgets.js";
import type { BudgetCheckResult } from "./budgets.js";


const UPSTREAM_HOST = "api.anthropic.com";

const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate",
  "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade",
]);

export interface ProxyContext {
  meterDir: string;
  pricing: PricingTable;
  registry: Map<string, CasaRegistryEntry>;
  counters: HotCounters;
  budgets: BudgetConfig;
}

/** Parse the CASA name from the request URL path: /casa/{name}/... */
export function parseCasaPath(url: string): { casa: string; upstreamPath: string } | null {
  const match = /^\/casa\/([a-z0-9-]+)(\/.*)$/.exec(url);
  if (!match) return null;
  return { casa: match[1]!, upstreamPath: match[2]! };
}

/** Build upstream headers: set Host, strip hop-by-hop */
export function buildUpstreamHeaders(
  incoming: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (HOP_BY_HOP.has(key.toLowerCase())) continue;
    if (value === undefined) continue;
    headers[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  headers["host"] = UPSTREAM_HOST;
  return headers;
}

/** Build a MeterEvent from proxy usage data and compute cost */
export function buildMeterEvent(
  ctx: ProxyContext,
  startMs: number,
  casa: string,
  casaInfo: CasaRegistryEntry,
  model: string,
  stream: boolean,
  status: number,
  usage: {
    inputTokens: number; outputTokens: number;
    cacheCreationTokens: number; cacheReadTokens: number;
    modelActual: string; ttftMs: number | null;
  },
): MeterEvent {
  const pricing = resolvePricing(ctx.pricing, usage.modelActual || model);
  // Compute cost for 200 and -1 (client disconnect with partial usage consumed)
  const costUsd = (status === 200 || status === -1) ? computeCost(pricing, usage) : 0;

  return {
    id: ulid(),
    ts: new Date().toISOString(),
    casa,
    authProfile: casaInfo.authProfile,
    workspace: casaInfo.workspace,
    tags: casaInfo.tags,
    model,
    stream,
    status,
    modelActual: usage.modelActual || model,
    latencyMs: Date.now() - startMs,
    ttftMs: usage.ttftMs,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheCreationTokens: usage.cacheCreationTokens,
    cacheReadTokens: usage.cacheReadTokens,
    costUsd,
  };
}

/** Run budget check for a CASA request. Returns null if allowed. */
export function enforceBudget(
  ctx: ProxyContext,
  casa: string,
  casaInfo: CasaRegistryEntry,
): BudgetCheckResult {
  const counters = ctx.counters;
  const casaBucket = counters.byCasa[casa];
  const authBucket = counters.byAuth[casaInfo.authProfile];
  const tagSummaries: Record<string, { today: import("./types.js").CostSummary; month: import("./types.js").CostSummary }> = {};
  for (const tag of casaInfo.tags) {
    const bucket = counters.byTag[tag];
    if (bucket) tagSummaries[tag] = { today: bucket.today, month: bucket.thisMonth };
  }

  return checkBudgets({
    config: ctx.budgets,
    casa,
    authProfile: casaInfo.authProfile,
    tags: casaInfo.tags,
    global: { today: counters.global.today, month: counters.global.thisMonth },
    perCasa: casaBucket ? { today: casaBucket.today, month: casaBucket.thisMonth } : undefined,
    perAuth: authBucket ? { today: authBucket.today, month: authBucket.thisMonth } : undefined,
    perTag: tagSummaries,
  });
}

/** Reload budgets from disk (called on SIGHUP) */
export function reloadBudgets(ctx: ProxyContext): void {
  ctx.budgets = readBudgets(ctx.meterDir);
}

/** Record a meter event: append to disk + update hot counters */
export function recordEvent(ctx: ProxyContext, event: MeterEvent): void {
  try {
    appendEvent(ctx.meterDir, event);
  } catch {
    console.error("[mecha:meter] Failed to write event:", event.id);
  }
  ingestEvent(ctx.counters, event);
}

/** Max request body size (32 MB) to prevent memory DoS */
export const MAX_BODY_BYTES = 32 * 1024 * 1024;

/** Extract model name and stream flag from a request body JSON. */
export function parseModelAndStream(body: Buffer): { model: string; stream: boolean } {
  try {
    const parsed = JSON.parse(body.toString()) as Record<string, unknown>;
    return {
      model: (typeof parsed.model === "string" ? parsed.model : ""),
      stream: (typeof parsed.stream === "boolean" ? parsed.stream : false),
    };
  } catch {
    return { model: "", stream: false };
  }
}

/** Strip hop-by-hop headers from upstream response headers. */
export function stripHopByHop(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = { ...headers };
  for (const h of HOP_BY_HOP) delete out[h];
  return out;
}

/* v8 ignore start -- integration code: wires Node.js HTTP streams to/from api.anthropic.com */
/** Handle a proxied request */
export function handleProxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ProxyContext,
): void {
  const startMs = Date.now();
  const url = req.url ?? "/";

  const parsed = parseCasaPath(url);
  if (!parsed) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: `Invalid path: ${url}. Expected /casa/{name}/...` }));
    return;
  }

  const { casa, upstreamPath } = parsed;
  const casaInfo = lookupCasa(ctx.registry, casa);

  if (casaInfo.workspace === "unknown") {
    console.error(`[mecha:meter] Unregistered CASA: ${casa}`);
  }

  const budgetResult = enforceBudget(ctx, casa, casaInfo);
  for (const w of budgetResult.warnings) {
    console.error(`[mecha:meter] Budget warning: ${w}`);
  }
  if (!budgetResult.allowed) {
    res.writeHead(429, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: budgetResult.exceeded }));
    return;
  }

  const bodyChunks: Buffer[] = [];
  let bodySize = 0;
  req.on("data", (chunk: Buffer) => {
    bodySize += chunk.length;
    if (bodySize > MAX_BODY_BYTES) {
      res.writeHead(413, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Request body too large" }));
      req.destroy();
      return;
    }
    bodyChunks.push(chunk);
  });
  req.on("end", () => {
    const body = Buffer.concat(bodyChunks);
    const { model, stream } = parseModelAndStream(body);

    const headers = buildUpstreamHeaders(
      req.headers as Record<string, string | string[] | undefined>,
    );
    headers["content-length"] = String(body.length);

    const upstreamReq = httpsRequest({
      hostname: UPSTREAM_HOST,
      port: 443,
      path: upstreamPath,
      method: req.method ?? "POST",
      headers,
    }, (upstreamRes: IncomingMessage) => {
      const status = upstreamRes.statusCode ?? 0;

      if (stream && status === 200) {
        handleStreamResponse(res, upstreamRes, ctx, startMs, casa, casaInfo, model);
      } else {
        handleNonStreamResponse(res, upstreamRes, ctx, startMs, casa, casaInfo, model, stream, status);
      }
    });

    upstreamReq.on("error", () => {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Upstream unreachable" }));
      const event = buildMeterEvent(ctx, startMs, casa, casaInfo, model, stream, 0, {
        inputTokens: 0, outputTokens: 0,
        cacheCreationTokens: 0, cacheReadTokens: 0,
        modelActual: model, ttftMs: null,
      });
      recordEvent(ctx, event);
    });

    upstreamReq.write(body);
    upstreamReq.end();
  });
}

function handleStreamResponse(
  res: ServerResponse,
  upstreamRes: IncomingMessage,
  ctx: ProxyContext,
  startMs: number,
  casa: string,
  casaInfo: CasaRegistryEntry,
  model: string,
): void {
  res.writeHead(200, stripHopByHop(upstreamRes.headers));

  const state = createSSEParseState(startMs, model);
  let clientDisconnected = false;

  res.socket?.on("close", () => { clientDisconnected = true; });

  upstreamRes.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    parseSSEChunk(text, state);
    if (!clientDisconnected) {
      try { res.write(chunk); } catch { clientDisconnected = true; }
    }
  });

  upstreamRes.on("error", () => { clientDisconnected = true; });

  upstreamRes.on("end", () => {
    res.end();
    const event = buildMeterEvent(ctx, startMs, casa, casaInfo, model, true,
      clientDisconnected ? -1 : 200, state);
    recordEvent(ctx, event);
  });
}

function handleNonStreamResponse(
  res: ServerResponse,
  upstreamRes: IncomingMessage,
  ctx: ProxyContext,
  startMs: number,
  casa: string,
  casaInfo: CasaRegistryEntry,
  model: string,
  stream: boolean,
  status: number,
): void {
  const chunks: Buffer[] = [];
  upstreamRes.on("data", (chunk: Buffer) => chunks.push(chunk));
  upstreamRes.on("end", () => {
    const body = Buffer.concat(chunks).toString();

    res.writeHead(status, stripHopByHop(upstreamRes.headers));
    res.end(body);

    const usage = status === 200
      ? extractNonStreamUsage(body)
      : { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, modelActual: model, ttftMs: null };

    const event = buildMeterEvent(ctx, startMs, casa, casaInfo, model, stream, status, usage);
    recordEvent(ctx, event);
  });
}
/* v8 ignore stop */
