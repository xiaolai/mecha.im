import { NextResponse, type NextRequest } from "next/server";
import { mechaSessionConfigUpdate } from "@mecha/service";
import { SessionNotFoundError, SessionBusyError, SessionConfig, toHttpStatus, toSafeMessage } from "@mecha/contracts";
import { getProcessManager } from "@/lib/process";
import { withAuth } from "@/lib/api-auth";
import { handleProcessError } from "@/lib/process-errors";

export const PUT = withAuth(async (request: NextRequest, { params }) => {
  const { id, sessionId } = await params;
  const pm = getProcessManager();
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = SessionConfig.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid config", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const result = await mechaSessionConfigUpdate(pm, { id, sessionId, config: parsed.data });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof SessionNotFoundError || err instanceof SessionBusyError) {
      return NextResponse.json({ error: toSafeMessage(err) }, { status: toHttpStatus(err) });
    }
    return handleProcessError(err);
  }
});
