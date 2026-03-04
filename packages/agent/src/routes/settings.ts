import type { FastifyInstance } from "fastify";
import { DEFAULTS } from "@mecha/core";

export function registerSettingsRoutes(app: FastifyInstance): void {
  app.get("/settings/runtime", async () => {
    return {
      botPortRange: `${DEFAULTS.RUNTIME_PORT_BASE}-${DEFAULTS.RUNTIME_PORT_MAX}`,
      agentPort: DEFAULTS.AGENT_PORT,
      mcpPort: DEFAULTS.MCP_HTTP_PORT,
    };
  });
}
