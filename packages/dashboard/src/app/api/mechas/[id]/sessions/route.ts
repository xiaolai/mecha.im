import { NextResponse, type NextRequest } from "next/server";
import { mechaSessionList, mechaSessionCreate, remoteSessionList } from "@mecha/service";
import { SessionCapReachedError, toHttpStatus, toSafeMessage } from "@mecha/contracts";
import { getDockerClient } from "@/lib/docker";
import { withAuth } from "@/lib/api-auth";
import { handleDockerError } from "@/lib/docker-errors";
import { resolveNodeTarget } from "@/lib/resolve-node";

export const GET = withAuth(async (request: NextRequest, { params }) => {
  const { id } = await params;
  const client = getDockerClient();
  try {
    const target = resolveNodeTarget(request);
    if (target.node !== "local") {
      const result = await remoteSessionList(client, id, target);
      return NextResponse.json(result);
    }
    const sessions = await mechaSessionList(client, { id });
    return NextResponse.json(sessions);
  } catch (err) {
    return handleDockerError(err);
  }
});

export const POST = withAuth(async (request: NextRequest, { params }) => {
  const { id } = await params;
  const client = getDockerClient();

  let body: { title?: string; config?: Record<string, unknown> };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const session = await mechaSessionCreate(client, { id, title: body.title, config: body.config });
    return NextResponse.json(session, { status: 201 });
  } catch (err) {
    if (err instanceof SessionCapReachedError) {
      return NextResponse.json({ error: toSafeMessage(err) }, { status: toHttpStatus(err) });
    }
    return handleDockerError(err);
  }
});
