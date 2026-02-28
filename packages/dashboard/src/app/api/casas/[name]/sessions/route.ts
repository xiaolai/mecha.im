import { NextResponse } from "next/server";
import { MechaError } from "@mecha/core";
import { casaSessionList } from "@mecha/service";
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
      return proxyRequest(dispatch.node, "GET", `/casas/${encodeURIComponent(raw)}/sessions`);
    }

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
