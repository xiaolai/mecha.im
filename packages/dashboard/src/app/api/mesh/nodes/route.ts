import { NextResponse } from "next/server";
import { getMechaDir, log } from "@/lib/pm-singleton";
import { fetchAllNodes } from "@/lib/mesh-proxy";

export async function GET(): Promise<NextResponse> {
  try {
    const mechaDir = getMechaDir();
    const { nodes } = await fetchAllNodes(mechaDir);
    return NextResponse.json(nodes);
  } catch (err) {
    log.error("GET /api/mesh/nodes", "Failed to read mesh nodes", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
