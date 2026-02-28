import { NextResponse } from "next/server";
import { MechaError } from "@mecha/core";
import { casaFind } from "@mecha/service";
import { getProcessManager, getMechaDir, log } from "@/lib/pm-singleton";
import { fetchAllCasas } from "@/lib/mesh-proxy";

function redactProcessInfo(info: Record<string, unknown>): Record<string, unknown> {
  const { token: _token, ...safe } = info;
  return safe;
}

export async function GET(): Promise<NextResponse> {
  try {
    const pm = getProcessManager();
    const mechaDir = getMechaDir();

    // Merge local + remote CASAs
    const { casas, nodeStatus } = await fetchAllCasas(pm, mechaDir);

    // Enrich local CASAs with full info from casaFind
    const localDetails = casaFind(mechaDir, pm, {});
    const detailMap = new Map(
      localDetails.map((c) => [c.name, redactProcessInfo(c as unknown as Record<string, unknown>)]),
    );

    const enriched = casas.map((c) => {
      if (c.node === "local") {
        const detail = detailMap.get(c.name);
        return detail ? { ...detail, node: "local" } : { ...c };
      }
      return c;
    });

    return NextResponse.json({ casas: enriched, nodeStatus });
  } catch (err) {
    log.error("GET /api/casas", "Failed to list CASAs", err);
    if (err instanceof MechaError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
