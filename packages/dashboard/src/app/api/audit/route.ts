import { NextResponse } from "next/server";
import { createAuditLog } from "@mecha/mcp-server";
import { getMechaDir } from "@/lib/pm-singleton";

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const mechaDir = getMechaDir();
    const url = new URL(req.url);
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : 50;
    const audit = createAuditLog(mechaDir);
    const entries = audit.read({ limit: isNaN(limit) ? 50 : limit });
    return NextResponse.json(entries);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
