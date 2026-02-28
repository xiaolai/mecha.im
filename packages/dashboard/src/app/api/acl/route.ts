import { NextResponse } from "next/server";
import { getAcl, log } from "@/lib/pm-singleton";

export async function GET(): Promise<NextResponse> {
  try {
    const acl = getAcl();
    const rules = acl.listRules();
    return NextResponse.json(rules);
  } catch (err) {
    log.error("GET /api/acl", "Failed to list ACL rules", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
