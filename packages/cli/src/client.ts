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

  /** Create a client targeting the given port. */
  constructor(port: number = DEFAULTS.AGENT_PORT) {
    this.baseUrl = `http://127.0.0.1:${port}`;
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

/**
 * Try to detect a running agent server port from mechaDir.
 * Returns the port number if agent.json exists and is valid, null otherwise.
 */
export function detectAgentPort(mechaDir: string): number | null {
  try {
    const raw = readFileSync(join(mechaDir, "agent.json"), "utf8");
    const data = JSON.parse(raw) as { port?: number };
    return typeof data.port === "number" ? data.port : null;
    /* v8 ignore start -- ENOENT/parse error expected when no server running */
  } catch {
    return null;
  }
  /* v8 ignore stop */
}
