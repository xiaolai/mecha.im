import { NextResponse, type NextRequest } from "next/server";
import { mechaSessionList, mechaSessionCreate, remoteSessionList, agentFetch } from "@mecha/service";
import { SessionCapReachedError, toHttpStatus, toSafeMessage } from "@mecha/contracts";
import { getProcessManager } from "@/lib/process";
import { withAuth } from "@/lib/api-auth";
import { handleProcessError } from "@/lib/process-errors";
import { resolveNodeTarget } from "@/lib/resolve-node";

export const GET = withAuth(async (request: NextRequest, { params }) => {
  const { id } = await params;
  const pm = getProcessManager();
  try {
    const target = resolveNodeTarget(request);
    if (target.node !== "local") {
      const result = await remoteSessionList(pm, id, target);
      return NextResponse.json(result);
    }
    const sessions = await mechaSessionList(pm, { id });
    return NextResponse.json(sessions);
  } catch (err) {
    return handleProcessError(err);
  }
});

export const POST = withAuth(async (request: NextRequest, { params }) => {
  const { id } = await params;
  const pm = getProcessManager();

  let body: { title?: string; config?: Record<string, unknown> };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const target = resolveNodeTarget(request);
    if (target.node !== "local" && target.entry) {
      const mid = encodeURIComponent(id);
      const res = await agentFetch(target.entry, `/mechas/${mid}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: body.title, config: body.config }),
      });
      const data = await res.json();
      return NextResponse.json(data, { status: 201 });
    }
    const session = await mechaSessionCreate(pm, { id, title: body.title, config: body.config });
    return NextResponse.json(session, { status: 201 });
  } catch (err) {
    if (err instanceof SessionCapReachedError) {
      return NextResponse.json({ error: toSafeMessage(err) }, { status: toHttpStatus(err) });
    }
    return handleProcessError(err);
  }
});
