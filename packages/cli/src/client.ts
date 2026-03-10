import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULTS } from "@mecha/core";

/**
 * HTTP client for communicating with a running Mecha agent server.
 * Used by CLI commands that need to detect or interact with the server.
 */
export class AgentClient {
  /** Base URL of the agent server (e.g. http://127.0.0.1:7660). */
  readonly baseUrl: string;

  /** Create a client targeting the given host and port. */
  constructor(port: number = DEFAULTS.AGENT_PORT, host: string = "127.0.0.1") {
    // Wrap IPv6 literals in brackets for valid URL, replace wildcards with loopback
    const normalized = host === "0.0.0.0" ? "127.0.0.1"
      : host === "::" ? "[::1]"
      : host.includes(":") ? `[${host}]`
      : host;
    this.baseUrl = `http://${normalized}:${port}`;
  }

  /** Check if the agent server is reachable. */
  async isAlive(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/healthz`, {
        signal: AbortSignal.timeout(2000),
      });
      return res.ok;
      /* v8 ignore start -- network error expected when server is down */
    } catch {
      return false;
    }
    /* v8 ignore stop */
  }
}

/** Agent discovery info from agent.json. */
export interface AgentInfo {
  port: number;
  host: string;
}

/**
 * Try to detect a running agent server from mechaDir.
 * Returns port and host if agent.json exists and is valid, null otherwise.
 */
export function detectAgent(mechaDir: string): AgentInfo | null {
  try {
    const raw = readFileSync(join(mechaDir, "agent.json"), "utf8");
    const data = JSON.parse(raw) as { port?: number; host?: string };
    if (typeof data.port !== "number" || !Number.isInteger(data.port) || data.port < 1 || data.port > 65535) return null;
    return { port: data.port, host: typeof data.host === "string" ? data.host : "127.0.0.1" };
    /* v8 ignore start -- ENOENT/parse error expected when no server running */
  } catch {
    return null;
  }
  /* v8 ignore stop */
}

/**
 * Try to detect a running agent server port from mechaDir.
 * @deprecated Use detectAgent() for port + host. Kept for backward compatibility.
 */
export function detectAgentPort(mechaDir: string): number | null {
  const info = detectAgent(mechaDir);
  return info?.port ?? null;
}
