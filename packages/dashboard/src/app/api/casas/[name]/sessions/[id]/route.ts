import { NextResponse } from "next/server";
import { MechaError } from "@mecha/core";
import { casaSessionGet } from "@mecha/service";
import { getProcessManager, log } from "@/lib/pm-singleton";
import { parseCasaNameParam } from "@/lib/params";
import { resolveNodeParam, proxyRequest } from "@/lib/node-dispatch";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ name: string; id: string }> },
): Promise<NextResponse> {
  try {
    const { name: raw, id } = await params;
    const [name, err] = parseCasaNameParam(raw);
    if (err) return err;

    const dispatch = await resolveNodeParam(req);
    if ("error" in dispatch) return dispatch.error;
    if (dispatch.node) {
      return proxyRequest(
        dispatch.node,
        "GET",
        `/casas/${encodeURIComponent(raw)}/sessions/${encodeURIComponent(id)}`,
      );
    }

    const pm = getProcessManager();
    const session = await casaSessionGet(pm, name, id);
    if (session === undefined) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    return NextResponse.json(session);
  } catch (err) {
    log.error("GET /api/casas/[name]/sessions/[id]", "Failed to get session", err);
    if (err instanceof MechaError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
