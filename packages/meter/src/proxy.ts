import { request as httpsRequest } from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { MeterEvent, PricingTable } from "./types.js";
import type { CasaRegistryEntry } from "./types.js";
import { parseSSEChunk, createSSEParseState, extractNonStreamUsage } from "./stream.js";
import { computeCost, resolvePricing } from "./pricing.js";
import { ulid } from "./ulid.js";
import { appendEvent } from "./events.js";
import { lookupCasa } from "./registry.js";

const UPSTREAM_HOST = "api.anthropic.com";

const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate",
  "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade",
]);

export interface ProxyContext {
  meterDir: string;
  pricing: PricingTable;
  registry: Map<string, CasaRegistryEntry>;
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

/* v8 ignore start -- integration code: makes real HTTPS calls to api.anthropic.com */
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

  // Read request body
  const bodyChunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => bodyChunks.push(chunk));
  req.on("end", () => {
    const body = Buffer.concat(bodyChunks);

    // Parse request to extract model and stream flag
    let model = "";
    let stream = false;
    try {
      const parsed = JSON.parse(body.toString()) as Record<string, unknown>;
      model = (parsed.model as string) ?? "";
      stream = (parsed.stream as boolean) ?? false;
    } catch {
      // Not JSON or not parseable — still forward
    }

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
      // Upstream unreachable
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Upstream unreachable" }));
      writeEvent(ctx, startMs, casa, casaInfo, model, stream, 0, {
        inputTokens: 0, outputTokens: 0,
        cacheCreationTokens: 0, cacheReadTokens: 0,
        modelActual: model, ttftMs: null,
      });
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
  // Forward status + headers
  const responseHeaders = { ...upstreamRes.headers };
  for (const h of HOP_BY_HOP) delete responseHeaders[h];
  res.writeHead(200, responseHeaders);

  const state = createSSEParseState(startMs, model);
  let clientDisconnected = false;

  res.socket?.on("close", () => { clientDisconnected = true; });

  upstreamRes.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    parseSSEChunk(text, state);
    /* v8 ignore start -- can't simulate client disconnect in unit tests */
    if (!clientDisconnected) {
      try { res.write(chunk); } catch { clientDisconnected = true; }
    }
    /* v8 ignore stop */
  });

  upstreamRes.on("end", () => {
    res.end();
    writeEvent(ctx, startMs, casa, casaInfo, model, true,
      clientDisconnected ? -1 : 200, state);
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

    // Forward response
    const responseHeaders = { ...upstreamRes.headers };
    for (const h of HOP_BY_HOP) delete responseHeaders[h];
    res.writeHead(status, responseHeaders);
    res.end(body);

    // Extract usage
    if (status === 200) {
      const usage = extractNonStreamUsage(body);
      writeEvent(ctx, startMs, casa, casaInfo, model, stream, status, usage);
    } else {
      writeEvent(ctx, startMs, casa, casaInfo, model, stream, status, {
        inputTokens: 0, outputTokens: 0,
        cacheCreationTokens: 0, cacheReadTokens: 0,
        modelActual: model, ttftMs: null,
      });
    }
  });
}

function writeEvent(
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
): void {
  const pricing = resolvePricing(ctx.pricing, usage.modelActual || model);
  const costUsd = status === 200 ? computeCost(pricing, usage) : 0;

  const event: MeterEvent = {
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

  try {
    appendEvent(ctx.meterDir, event);
  } catch {
    console.error("[mecha:meter] Failed to write event:", event.id);
  }
}
/* v8 ignore stop */
