import { createHttpGateway, GatewayDeniedError } from "@mecha/gateway";
import type { CredentialStore, HttpGateway, HttpMethod } from "@mecha/gateway";

interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** MCP tool definition for gateway HTTP requests. */
export const GATEWAY_TOOLS: McpToolDef[] = [
  {
    name: "gateway_http_request",
    description: "Make an HTTP request through the gateway (host must be in allowlist)",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Full URL to request" },
        method: {
          type: "string",
          enum: ["GET", "POST", "PUT", "DELETE"],
          description: "HTTP method (default: GET)",
        },
        headers: {
          type: "object",
          description: "Request headers (optional)",
          additionalProperties: { type: "string" },
        },
        body: { type: "string", description: "Request body (optional, ignored for GET)" },
      },
      required: ["url"],
    },
  },
];

/** Runtime context for gateway tool execution. */
export interface GatewayToolOpts {
  /** Credential store for access checks. */
  credentialStore: CredentialStore;
  /** Bot name for access verification. */
  botName: string;
  /** Allowed hosts for outbound HTTP requests. */
  allowedHosts: string[];
}

interface GatewayResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

const VALID_METHODS = new Set(["GET", "POST", "PUT", "DELETE"]);

/** Cached gateways per unique allowlist hash. */
const gatewayCache = new Map<string, HttpGateway>();

function getGateway(allowedHosts: string[]): HttpGateway {
  const key = allowedHosts.slice().sort().join(",");
  let gw = gatewayCache.get(key);
  if (!gw) {
    gw = createHttpGateway({ allowedHosts });
    gatewayCache.set(key, gw);
  }
  return gw;
}

/** Dispatch a gateway tool call and return the MCP result. */
export async function handleGatewayTool(
  opts: GatewayToolOpts,
  name: string,
  args: Record<string, unknown>,
): Promise<GatewayResult> {
  if (name !== "gateway_http_request") {
    return { content: [{ type: "text", text: `Unknown gateway tool: ${name}` }], isError: true };
  }

  const url = args.url;
  if (typeof url !== "string" || !url) {
    return { content: [{ type: "text", text: "Missing required: url (string)" }], isError: true };
  }

  const method = args.method ?? "GET";
  if (typeof method !== "string" || !VALID_METHODS.has(method)) {
    return { content: [{ type: "text", text: "Invalid method: must be GET, POST, PUT, or DELETE" }], isError: true };
  }

  // Validate headers if provided
  const headers = args.headers as Record<string, string> | undefined;
  if (headers !== undefined && (typeof headers !== "object" || headers === null || Array.isArray(headers))) {
    return { content: [{ type: "text", text: "Invalid headers: must be an object" }], isError: true };
  }

  const body = typeof args.body === "string" ? args.body : undefined;

  // Check credential store for gateway_outbound access
  if (!opts.credentialStore.checkAccess("gateway_outbound", opts.botName)) {
    return { content: [{ type: "text", text: "Access denied: bot does not have gateway_outbound access" }], isError: true };
  }

  const gw = getGateway(opts.allowedHosts);

  try {
    /* v8 ignore start -- live HTTP call through gateway; tested via integration tests */
    const result = await gw.executeRequest(url, {
      method: method as HttpMethod,
      headers,
      body,
    });

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          status: result.status,
          headers: result.headers,
          body: result.body,
        }),
      }],
    };
    /* v8 ignore stop */
  } catch (err) {
    if (err instanceof GatewayDeniedError) {
      return { content: [{ type: "text", text: `Access denied: ${err.message}` }], isError: true };
    }
    /* v8 ignore start -- non-GatewayDeniedError requires live network failure */
    const detail = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Gateway request failed: ${detail}` }], isError: true };
    /* v8 ignore stop */
  }
}
