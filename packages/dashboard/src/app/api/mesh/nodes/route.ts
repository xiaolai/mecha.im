import { NextResponse } from "next/server";
import { readNodes } from "@mecha/core";
import { getMechaDir, log } from "@/lib/pm-singleton";

export async function GET(): Promise<NextResponse> {
  try {
    const mechaDir = getMechaDir();
    const nodes = readNodes(mechaDir);
    const safe = nodes.map(({ apiKey: _apiKey, ...rest }) => rest);
    return NextResponse.json(safe);
  } catch (err) {
    log.error("GET /api/mesh/nodes", "Failed to read mesh nodes", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
