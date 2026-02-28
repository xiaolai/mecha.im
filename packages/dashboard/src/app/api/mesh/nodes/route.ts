import { NextResponse } from "next/server";
import { readNodes } from "@mecha/core";
import { getMechaDir, log } from "@/lib/pm-singleton";

export async function GET(): Promise<NextResponse> {
  try {
    const mechaDir = getMechaDir();
    const nodes = readNodes(mechaDir);
    return NextResponse.json(nodes);
  } catch (err) {
    log.error("GET /api/mesh/nodes", "Failed to read mesh nodes", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
