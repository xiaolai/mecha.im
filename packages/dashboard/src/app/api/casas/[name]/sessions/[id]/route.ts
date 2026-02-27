import { NextResponse } from "next/server";
import { MechaError } from "@mecha/core";
import { casaSessionGet } from "@mecha/service";
import { getProcessManager } from "@/lib/pm-singleton";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string; id: string }> },
): Promise<NextResponse> {
  try {
    const { name, id } = await params;
    const pm = getProcessManager();
    const session = await casaSessionGet(pm, name as never, id);
    if (session === undefined) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    return NextResponse.json(session);
  } catch (err) {
    if (err instanceof MechaError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
