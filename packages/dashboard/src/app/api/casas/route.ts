import { NextResponse } from "next/server";
import { MechaError } from "@mecha/core";
import { casaFind } from "@mecha/service";
import { getProcessManager, getMechaDir, log } from "@/lib/pm-singleton";

function redactProcessInfo(info: Record<string, unknown>): Record<string, unknown> {
  const { token: _token, ...safe } = info;
  return safe;
}

export async function GET(): Promise<NextResponse> {
  try {
    const pm = getProcessManager();
    const mechaDir = getMechaDir();
    const casas = casaFind(mechaDir, pm, {});
    return NextResponse.json(casas.map((c) => redactProcessInfo(c as unknown as Record<string, unknown>)));
  } catch (err) {
    log.error("GET /api/casas", "Failed to list CASAs", err);
    if (err instanceof MechaError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
