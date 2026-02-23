import { NextResponse, type NextRequest } from "next/server";
import {
  mechaSessionGet,
  mechaSessionDelete,
  mechaSessionRename,
  remoteSessionGet,
  remoteSessionMetaUpdate,
  remoteSessionDelete,
} from "@mecha/service";
import { SessionNotFoundError, toHttpStatus, toSafeMessage } from "@mecha/contracts";
import { getProcessManager } from "@/lib/process";
import { withAuth } from "@/lib/api-auth";
import { handleProcessError } from "@/lib/process-errors";
import { resolveNodeTarget } from "@/lib/resolve-node";

export const GET = withAuth(async (request: NextRequest, { params }) => {
  const { id, sessionId } = await params;
  const pm = getProcessManager();
  try {
    const target = resolveNodeTarget(request);
    if (target.node !== "local") {
      const session = await remoteSessionGet(pm, id, sessionId, target);
      return NextResponse.json(session);
    }
    const session = await mechaSessionGet(pm, { id, sessionId });
    return NextResponse.json(session);
  } catch (err) {
    if (err instanceof SessionNotFoundError) {
      return NextResponse.json({ error: toSafeMessage(err) }, { status: toHttpStatus(err) });
    }
    return handleProcessError(err);
  }
});

export const PATCH = withAuth(async (request: NextRequest, { params }) => {
  const { id, sessionId } = await params;
  const pm = getProcessManager();

  let body: { title?: string; starred?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body || (body.title === undefined && body.starred === undefined)) {
    return NextResponse.json({ error: "Missing 'title' or 'starred' field" }, { status: 400 });
  }

  // Validate title if provided
  if (body.title !== undefined && (typeof body.title !== "string" || !body.title.trim())) {
    return NextResponse.json({ error: "'title' must be a non-empty string" }, { status: 400 });
  }

  // Validate starred if provided
  if (body.starred !== undefined && typeof body.starred !== "boolean") {
    return NextResponse.json({ error: "'starred' must be a boolean" }, { status: 400 });
  }

  try {
    const target = resolveNodeTarget(request);

    if (target.node !== "local") {
      // Remote: dispatch via agent
      const meta: { customTitle?: string; starred?: boolean } = {};
      if (typeof body.title === "string") meta.customTitle = body.title;
      if (body.starred !== undefined) meta.starred = body.starred;
      await remoteSessionMetaUpdate(id, sessionId, meta, target);
      return NextResponse.json({ ok: true });
    }

    // Local: handle title rename and starred toggle
    if (typeof body.title === "string") {
      const result = await mechaSessionRename(pm, { id, sessionId, title: body.title });
      if (body.starred === undefined) {
        return NextResponse.json(result);
      }
    }

    if (body.starred !== undefined) {
      const { setSessionMeta } = await import("@mecha/core");
      setSessionMeta(id, sessionId, { starred: body.starred });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof SessionNotFoundError) {
      return NextResponse.json({ error: toSafeMessage(err) }, { status: toHttpStatus(err) });
    }
    return handleProcessError(err);
  }
});

export const DELETE = withAuth(async (request: NextRequest, { params }) => {
  const { id, sessionId } = await params;
  const pm = getProcessManager();
  try {
    const target = resolveNodeTarget(request);
    if (target.node !== "local") {
      await remoteSessionDelete(pm, id, sessionId, target);
      return new NextResponse(null, { status: 204 });
    }
    await mechaSessionDelete(pm, { id, sessionId });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof SessionNotFoundError) {
      return NextResponse.json({ error: toSafeMessage(err) }, { status: toHttpStatus(err) });
    }
    return handleProcessError(err);
  }
});
