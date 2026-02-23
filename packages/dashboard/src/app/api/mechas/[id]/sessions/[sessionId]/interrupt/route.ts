import { NextResponse, type NextRequest } from "next/server";
import { mechaSessionInterrupt } from "@mecha/service";
import { SessionNotFoundError, toHttpStatus, toSafeMessage } from "@mecha/contracts";
import { getProcessManager } from "@/lib/process";
import { withAuth } from "@/lib/api-auth";
import { handleProcessError } from "@/lib/process-errors";

export const POST = withAuth(async (_request: NextRequest, { params }) => {
  const { id, sessionId } = await params;
  const pm = getProcessManager();
  try {
    const result = await mechaSessionInterrupt(pm, { id, sessionId });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof SessionNotFoundError) {
      return NextResponse.json({ error: toSafeMessage(err) }, { status: toHttpStatus(err) });
    }
    return handleProcessError(err);
  }
});
