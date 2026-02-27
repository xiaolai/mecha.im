import { NextResponse } from "next/server";
import { MechaError } from "@mecha/core";
import { casaSessionList } from "@mecha/service";
import { getProcessManager } from "@/lib/pm-singleton";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> },
): Promise<NextResponse> {
  try {
    const { name } = await params;
    const pm = getProcessManager();
    const sessions = await casaSessionList(pm, name as never);
    return NextResponse.json(sessions);
  } catch (err) {
    if (err instanceof MechaError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
