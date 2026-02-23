import { NextResponse, type NextRequest } from "next/server";
import { resolveMcpEndpoint } from "@mecha/service";
import { ContainerNotFoundError } from "@mecha/core";
import { getProcessManager } from "@/lib/process";
import { withAuth } from "@/lib/api-auth";

export const GET = withAuth(async (request: NextRequest, { params }) => {
  const { id } = await params;
  const pm = getProcessManager();
  const reveal = request.nextUrl.searchParams.get("reveal") === "true";
  try {
    const { endpoint, token } = await resolveMcpEndpoint(pm, id);
    const maskedToken = token
      ? `${token.slice(0, 4)}...${token.slice(-4)}`
      : undefined;
    const config = {
      name: `mecha-${id}`,
      url: endpoint,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    };
    return NextResponse.json({
      endpoint,
      token: reveal ? token : maskedToken,
      config,
    });
  } catch (err) {
    if (err instanceof ContainerNotFoundError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: "Failed to resolve MCP endpoint" },
      { status: 500 },
    );
  }
});
