/**
 * Agent auth helper — resolves the agent server URL and authentication token
 * for CLI commands that need to talk to the agent server.
 */
import { createHmac } from "node:crypto";
import { detectAgent } from "./client.js";
import { readTotpSecret } from "@mecha/core";

export interface AgentAuth {
  agentUrl: string;
  auth: string; // Bearer token (mesh routing key derived from TOTP secret)
}

/**
 * Resolve agent URL and auth credentials from mechaDir.
 * Throws if agent is not running or TOTP secret is missing.
 */
export function resolveAgentAuth(mechaDir: string): AgentAuth {
  const agent = detectAgent(mechaDir);
  if (!agent) {
    throw new Error("Agent server not running. Start with: mecha start");
  }

  // Normalize wildcard bind addresses to loopback for connect
  const host = agent.host === "0.0.0.0" ? "127.0.0.1"
    : agent.host === "::" ? "[::1]"
    : agent.host.includes(":") ? `[${agent.host}]`
    : agent.host;
  const agentUrl = `http://${host}:${agent.port}`;

  // Derive mesh routing key from TOTP secret (same derivation as mecha start)
  const totpSecret = readTotpSecret(mechaDir);
  if (!totpSecret) {
    throw new Error("TOTP secret not found. Run: mecha start (first run creates it)");
  }

  const auth = createHmac("sha256", totpSecret)
    .update("mecha-mesh-routing")
    .digest("hex");

  return { agentUrl, auth };
}
