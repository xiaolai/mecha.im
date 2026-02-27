import { NextResponse } from "next/server";
import { getAcl } from "@/lib/pm-singleton";

export async function GET(): Promise<NextResponse> {
  try {
    const acl = getAcl();
    const rules = acl.listRules();
    return NextResponse.json(rules);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
