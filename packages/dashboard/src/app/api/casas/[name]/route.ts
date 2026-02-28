import { NextResponse } from "next/server";
import { MechaError } from "@mecha/core";
import { casaStatus } from "@mecha/service";
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
    const { token: _token, ...safe } = casaStatus(pm, name) as Record<string, unknown>;
    return NextResponse.json(safe);
  } catch (err) {
    log.error("GET /api/casas/[name]", "Failed to get CASA status", err);
    if (err instanceof MechaError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
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
    log.error("DELETE /api/casas/[name]", "Failed to delete CASA", err);
    if (err instanceof MechaError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
