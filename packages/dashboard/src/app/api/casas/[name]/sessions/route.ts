import { NextResponse } from "next/server";
import { MechaError } from "@mecha/core";
import { casaSessionList } from "@mecha/service";
import { getProcessManager, log } from "@/lib/pm-singleton";
import { parseCasaNameParam } from "@/lib/params";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> },
): Promise<NextResponse> {
  try {
    const { name: raw } = await params;
    const [name, err] = parseCasaNameParam(raw);
    if (err) return err;
    const pm = getProcessManager();
    const sessions = await casaSessionList(pm, name);
    return NextResponse.json(sessions);
  } catch (err) {
    log.error("GET /api/casas/[name]/sessions", "Failed to list sessions", err);
    if (err instanceof MechaError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
