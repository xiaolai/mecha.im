import { NextResponse } from "next/server";
import { join } from "node:path";
import { queryCostToday, queryCostForCasa } from "@mecha/meter";
import { getMechaDir, log } from "@/lib/pm-singleton";

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const mechaDir = getMechaDir();
    const meterDir = join(mechaDir, "meter");
    const url = new URL(req.url);
    const casa = url.searchParams.get("casa");

    const result = casa
      ? queryCostForCasa(meterDir, casa)
      : queryCostToday(meterDir);

    return NextResponse.json(result);
  } catch (err) {
    log.error("GET /api/meter/cost", "Failed to query meter cost", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
