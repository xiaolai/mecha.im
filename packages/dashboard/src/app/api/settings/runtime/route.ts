import { NextResponse } from "next/server";
import { DEFAULTS } from "@mecha/core";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    casaPortRange: `${DEFAULTS.RUNTIME_PORT_BASE}-${DEFAULTS.RUNTIME_PORT_MAX}`,
    agentPort: DEFAULTS.AGENT_PORT,
    mcpPort: DEFAULTS.MCP_HTTP_PORT,
  });
}
