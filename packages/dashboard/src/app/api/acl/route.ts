import { NextResponse } from "next/server";
import { getAcl, log } from "@/lib/pm-singleton";

export async function GET(): Promise<NextResponse> {
  try {
    const acl = getAcl();
    const rules = acl.listRules();
    return NextResponse.json(rules);
  } catch (err) {
    log.error("GET /api/acl", "Failed to list ACL rules", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
