import { NextResponse } from "next/server";
import { createAuditLog } from "@mecha/mcp-server";
import { getMechaDir, log } from "@/lib/pm-singleton";

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const mechaDir = getMechaDir();
    const url = new URL(req.url);
    const limitParam = url.searchParams.get("limit");
    const parsed = limitParam ? parseInt(limitParam, 10) : 50;
    const limit = isNaN(parsed) ? 50 : Math.max(1, Math.min(parsed, 1000));
    const audit = createAuditLog(mechaDir);
    const entries = audit.read({ limit });
    return NextResponse.json(entries);
  } catch (err) {
    log.error("GET /api/audit", "Failed to read audit log", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
