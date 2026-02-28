import { NextResponse } from "next/server";
import { MechaError } from "@mecha/core";
import { casaStatus } from "@mecha/service";
import { getProcessManager, log } from "@/lib/pm-singleton";
import { parseCasaNameParam } from "@/lib/params";
import { resolveNodeParam, proxyRequest } from "@/lib/node-dispatch";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ name: string }> },
): Promise<NextResponse> {
  try {
    const { name: raw } = await params;
    const [name, err] = parseCasaNameParam(raw);
    if (err) return err;

    const dispatch = await resolveNodeParam(req);
    if ("error" in dispatch) return dispatch.error;
    if (dispatch.node) {
      return proxyRequest(dispatch.node, "GET", `/casas/${encodeURIComponent(raw)}/status`);
    }

    const pm = getProcessManager();
    const { token: _token, ...safe } = casaStatus(pm, name) as unknown as Record<string, unknown>;
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
  req: Request,
  { params }: { params: Promise<{ name: string }> },
): Promise<NextResponse> {
  try {
    const { name: raw } = await params;
    const [name, err] = parseCasaNameParam(raw);
    if (err) return err;

    const dispatch = await resolveNodeParam(req);
    if ("error" in dispatch) return dispatch.error;
    if (dispatch.node) {
      return proxyRequest(dispatch.node, "POST", `/casas/${encodeURIComponent(raw)}/kill`);
    }

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
