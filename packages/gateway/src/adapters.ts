/**
 * Gateway adapter interfaces for external service integration.
 * Each adapter receives inbound events and/or sends outbound messages.
 * Implementations require live API tokens — these are the contracts.
 */

/** Inbound event from an external service. */
export interface InboundEvent {
  adapter: string;
  event: string;
  payload: Record<string, unknown>;
  receivedAt: string;
}

/** Outbound message to an external service. */
export interface OutboundMessage {
  adapter: string;
  action: string;
  params: Record<string, unknown>;
}

/** Result of sending an outbound message. */
export interface OutboundResult {
  success: boolean;
  response?: unknown;
  error?: string;
}

/** Gateway adapter interface — implement per service. */
export interface GatewayAdapter {
  /** Adapter name (e.g., "github", "slack"). */
  readonly name: string;

  /** Parse an inbound webhook payload into a structured event. */
  parseWebhook?(headers: Record<string, string>, body: unknown): InboundEvent | null;

  /** Send an outbound message to the service. */
  send?(message: OutboundMessage): Promise<OutboundResult>;

  /** Verify webhook signature (if applicable). */
  verifySignature?(headers: Record<string, string>, body: string, secret: string): boolean;
}

/** Adapter configuration from adapters.yaml. */
export interface AdapterConfig {
  type: "webhook" | "websocket" | "poll";
  path?: string;
  secret?: string;
  token?: string;
  mappings?: Array<{
    event: string;
    topic: string;
    filter?: string;
    payload?: string;
  }>;
}

/** GitHub adapter stub — implement when GITHUB_TOKEN is available. */
export const githubAdapter: GatewayAdapter = {
  name: "github",
  parseWebhook(headers, body) {
    const event = headers["x-github-event"];
    if (!event) return null;
    return {
      adapter: "github",
      event,
      payload: body as Record<string, unknown>,
      receivedAt: new Date().toISOString(),
    };
  },
};

/** Slack adapter stub — implement when SLACK_BOT_TOKEN is available. */
export const slackAdapter: GatewayAdapter = {
  name: "slack",
};

/** Email adapter stub — implement when IMAP/SMTP credentials are available. */
export const emailAdapter: GatewayAdapter = {
  name: "email",
};

/** Discord adapter stub — implement when DISCORD_BOT_TOKEN is available. */
export const discordAdapter: GatewayAdapter = {
  name: "discord",
};

/** Linear adapter stub — implement when LINEAR_API_KEY is available. */
export const linearAdapter: GatewayAdapter = {
  name: "linear",
};

/** Registry of available adapters. */
export const ADAPTER_REGISTRY: Record<string, GatewayAdapter> = {
  github: githubAdapter,
  slack: slackAdapter,
  email: emailAdapter,
  discord: discordAdapter,
  linear: linearAdapter,
};
