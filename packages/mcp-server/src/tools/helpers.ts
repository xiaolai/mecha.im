import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { MeshMcpContext, ToolName } from "../types.js";
import { TOOL_ANNOTATIONS } from "../types.js";

export function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

export function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

export function withAuditAndRateLimit(
  ctx: MeshMcpContext,
  toolName: ToolName,
  fn: (args: Record<string, unknown>) => Promise<CallToolResult>,
): (args: Record<string, unknown>) => Promise<CallToolResult> {
  return async (args) => {
    const start = Date.now();
    const client = ctx.clientInfo
      ? `${ctx.clientInfo.name}/${ctx.clientInfo.version}`
      : "unknown";

    if (!ctx.rateLimiter.check(toolName)) {
      const message = `Rate limited: ${toolName} — try again shortly.`;
      ctx.audit.append({
        ts: new Date().toISOString(),
        client,
        tool: toolName,
        params: args as Record<string, unknown>,
        result: "rate-limited",
        durationMs: Date.now() - start,
      });
      return errorResult(message);
    }

    try {
      const result = await fn(args);
      ctx.audit.append({
        ts: new Date().toISOString(),
        client,
        tool: toolName,
        params: args as Record<string, unknown>,
        result: result.isError ? "error" : "ok",
        error: result.isError ? extractText(result) : undefined,
        durationMs: Date.now() - start,
      });
      return result;
    } catch (err: unknown) {
      /* v8 ignore start -- non-Error throws are defensive */
      const message = err instanceof Error ? err.message : String(err);
      /* v8 ignore stop */
      ctx.audit.append({
        ts: new Date().toISOString(),
        client,
        tool: toolName,
        params: args as Record<string, unknown>,
        result: "error",
        error: message,
        durationMs: Date.now() - start,
      });
      return errorResult(message);
    }
  };
}

/* v8 ignore start -- errorResult always produces text content, unreachable false branch */
function extractText(result: CallToolResult): string | undefined {
  const first = result.content[0];
  if (first && "text" in first) return first.text;
  return undefined;
}
/* v8 ignore stop */

export function annotationsFor(toolName: ToolName) {
  return TOOL_ANNOTATIONS[toolName];
}
