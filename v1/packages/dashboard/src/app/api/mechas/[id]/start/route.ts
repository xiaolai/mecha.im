import { NextResponse, type NextRequest } from "next/server";
import { mechaStart } from "@mecha/service";
import { getProcessManager } from "@/lib/process";
import { withAuth } from "@/lib/api-auth";
import { handleProcessError } from "@/lib/process-errors";

export const POST = withAuth(async (_request: NextRequest, { params }) => {
  const { id } = await params;
  const pm = getProcessManager();
  try {
    await mechaStart(pm, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleProcessError(err);
  }
});
