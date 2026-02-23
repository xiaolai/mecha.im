import { NextResponse } from "next/server";
import { mechaPrune } from "@mecha/service";
import { toHttpStatus, toSafeMessage } from "@mecha/contracts";
import { getProcessManager } from "@/lib/process";
import { withAuth } from "@/lib/api-auth";

export const POST = withAuth(async () => {
  const pm = getProcessManager();
  try {
    const result = await mechaPrune(pm);
    return NextResponse.json(result);
  } catch (err) {
    const status = toHttpStatus(err);
    return NextResponse.json({ error: toSafeMessage(err) }, { status });
  }
});
