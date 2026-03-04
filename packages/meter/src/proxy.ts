import { request as httpsRequest } from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { BotRegistryEntry } from "./types.js";
import { parseSSEChunk, createSSEParseState, extractNonStreamUsage } from "./stream.js";
import { lookupBot } from "./registry.js";
import { createLogger } from "@mecha/core";

import {
  parseBotPath,
  buildUpstreamHeaders,
  buildMeterEvent,
  enforceBudget,
  recordEvent,
  parseModelAndStream,
  stripHopByHop,
  MAX_BODY_BYTES,
  MAX_RESPONSE_BYTES,
} from "./proxy-utils.js";
import type { ProxyContext } from "./proxy-utils.js";

// Re-export everything from proxy-utils for backward compatibility
export {
  parseBotPath,
  buildUpstreamHeaders,
  buildMeterEvent,
  enforceBudget,
  reloadBudgets,
  recordEvent,
  getDroppedEventCount,
  resetDroppedEventCount,
  parseModelAndStream,
  stripHopByHop,
  ESTIMATED_REQUEST_COST_USD,
  MAX_BODY_BYTES,
  MAX_RESPONSE_BYTES,
} from "./proxy-utils.js";
export type { ProxyContext } from "./proxy-utils.js";

const log = createLogger("mecha:meter");

const UPSTREAM_HOST = "api.anthropic.com";

/* v8 ignore start -- integration code: wires Node.js HTTP streams to/from api.anthropic.com */

/** Decrement in-flight counter and clean up zero entries to prevent unbounded map growth. */
function endPending(ctx: ProxyContext, bot: string): void {
  const count = (ctx.pendingRequests.get(bot) ?? 1) - 1;
  if (count <= 0) {
    ctx.pendingRequests.delete(bot);
  } else {
    ctx.pendingRequests.set(bot, count);
  }
}
/** Handle a proxied request */
export function handleProxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ProxyContext,
): void {
  const startMs = Date.now();
  const url = req.url ?? "/";

  const parsed = parseBotPath(url);
  if (!parsed) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid path. Expected /bot/{name}/..." }));
    return;
  }

  const { bot, upstreamPath } = parsed;
  const botInfo = lookupBot(ctx.registry, bot);

  if (botInfo.workspace === "unknown") {
    log.warn("Unregistered bot", { bot });
  }

  const budgetResult = enforceBudget(ctx, bot, botInfo);
  for (const w of budgetResult.warnings) {
    log.warn("Budget warning", { detail: w });
  }
  if (!budgetResult.allowed) {
    res.writeHead(429, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: budgetResult.exceeded }));
    return;
  }

  // Track in-flight requests for budget pre-accounting
  ctx.pendingRequests.set(bot, (ctx.pendingRequests.get(bot) ?? 0) + 1);

  // Handle client abort before upstream request is made
  let requestCompleted = false;
  const cleanupPending = () => {
    if (!requestCompleted) {
      requestCompleted = true;
      endPending(ctx, bot);
    }
  };
  req.on("error", cleanupPending);
  req.on("close", () => { if (!requestCompleted) cleanupPending(); });

  const bodyChunks: Buffer[] = [];
  let bodySize = 0;
  let bodyRejected = false;
  req.on("data", (chunk: Buffer) => {
    if (bodyRejected) return;
    bodySize += chunk.length;
    if (bodySize > MAX_BODY_BYTES) {
      bodyRejected = true;
      requestCompleted = true;
      res.writeHead(413, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Request body too large" }));
      req.destroy();
      endPending(ctx, bot);
      return;
    }
    bodyChunks.push(chunk);
  });
  req.on("end", () => {
    if (bodyRejected) return;
    requestCompleted = true; // upstream handlers take over pending cleanup
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
        handleStreamResponse(res, upstreamRes, ctx, startMs, bot, botInfo, model);
      } else {
        handleNonStreamResponse(res, upstreamRes, ctx, startMs, bot, botInfo, model, stream, status);
      }
    });

    upstreamReq.setTimeout(60_000, () => {
      upstreamReq.destroy(new Error("Upstream timeout after 60s"));
    });

    upstreamReq.on("error", (err) => {
      log.error("Upstream request failed", { bot, path: upstreamPath, error: err instanceof Error ? err.message : String(err) });
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "application/json" });
      }
      res.end(JSON.stringify({ error: "Upstream unreachable" }));
      endPending(ctx, bot);
      const event = buildMeterEvent(ctx, startMs, bot, botInfo, model, stream, 0, {
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
  bot: string,
  botInfo: BotRegistryEntry,
  model: string,
): void {
  res.writeHead(200, stripHopByHop(upstreamRes.headers));

  const state = createSSEParseState(startMs, model);
  let clientDisconnected = false;

  res.socket?.on("close", () => {
    clientDisconnected = true;
    upstreamRes.destroy();
  });

  upstreamRes.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    parseSSEChunk(text, state);
    if (!clientDisconnected) {
      try { res.write(chunk); } catch { clientDisconnected = true; upstreamRes.destroy(); }
    }
  });

  let finalized = false;
  function finalizeStream(status: number): void {
    if (finalized) return;
    finalized = true;
    if (!res.writableEnded) res.end();
    endPending(ctx, bot);
    const event = buildMeterEvent(ctx, startMs, bot, botInfo, model, true, status, state);
    recordEvent(ctx, event);
  }

  upstreamRes.on("error", () => {
    clientDisconnected = true;
    finalizeStream(-1);
  });

  upstreamRes.on("end", () => {
    finalizeStream(clientDisconnected ? -1 : 200);
  });
}

function handleNonStreamResponse(
  res: ServerResponse,
  upstreamRes: IncomingMessage,
  ctx: ProxyContext,
  startMs: number,
  bot: string,
  botInfo: BotRegistryEntry,
  model: string,
  stream: boolean,
  status: number,
): void {
  const chunks: Buffer[] = [];
  let responseSize = 0;
  let oversized = false;
  let errorHandled = false;

  upstreamRes.on("error", () => {
    if (errorHandled || oversized) return;
    errorHandled = true;
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json" });
    }
    res.end(JSON.stringify({ error: "Upstream connection error" }));
    endPending(ctx, bot);
    const event = buildMeterEvent(ctx, startMs, bot, botInfo, model, stream, 502, {
      inputTokens: 0, outputTokens: 0,
      cacheCreationTokens: 0, cacheReadTokens: 0,
      modelActual: model, ttftMs: null,
    });
    recordEvent(ctx, event);
  });

  upstreamRes.on("data", (chunk: Buffer) => {
    responseSize += chunk.length;
    if (responseSize <= MAX_RESPONSE_BYTES) {
      chunks.push(chunk);
    } else if (!oversized) {
      oversized = true;
      upstreamRes.destroy();
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Upstream response too large" }));
      endPending(ctx, bot);
      const event = buildMeterEvent(ctx, startMs, bot, botInfo, model, stream, 502, {
        inputTokens: 0, outputTokens: 0,
        cacheCreationTokens: 0, cacheReadTokens: 0,
        modelActual: model, ttftMs: null,
      });
      recordEvent(ctx, event);
    }
  });
  upstreamRes.on("end", () => {
    if (oversized || errorHandled) return;
    const body = Buffer.concat(chunks).toString();

    res.writeHead(status, stripHopByHop(upstreamRes.headers));
    res.end(body);

    const usage = status === 200
      ? extractNonStreamUsage(body)
      : { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, modelActual: model, ttftMs: null };

    endPending(ctx, bot);
    const event = buildMeterEvent(ctx, startMs, bot, botInfo, model, stream, status, usage);
    recordEvent(ctx, event);
  });
}
/* v8 ignore stop */
