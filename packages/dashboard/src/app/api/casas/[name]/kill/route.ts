import { NextResponse } from "next/server";
import { MechaError } from "@mecha/core";
import { getProcessManager, log } from "@/lib/pm-singleton";
import { parseCasaNameParam } from "@/lib/params";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ name: string }> },
): Promise<NextResponse> {
  try {
    const { name: raw } = await params;
    const [name, err] = parseCasaNameParam(raw);
    if (err) return err;
    const pm = getProcessManager();
    await pm.kill(name);
    return NextResponse.json({ ok: true });
  } catch (err) {
    log.error("POST /api/casas/[name]/kill", "Failed to kill CASA", err);
    if (err instanceof MechaError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
