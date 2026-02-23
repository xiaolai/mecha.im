import { NextResponse } from "next/server";
import { mechaDoctor } from "@mecha/service";
import { withAuth } from "@/lib/api-auth";

export const GET = withAuth(async () => {
  const result = await mechaDoctor();

  const checks = [
    {
      name: "claude-cli",
      ok: result.claudeCliAvailable,
      message: result.claudeCliAvailable ? "Claude CLI is available" : "Claude CLI is not available",
    },
    {
      name: "sandbox",
      ok: result.sandboxSupported,
      message: result.sandboxSupported ? "Sandbox is supported" : "Sandbox is not supported",
    },
  ];

  const healthy = checks.every((c) => c.ok);
  return NextResponse.json({ healthy, checks, issues: result.issues }, { status: healthy ? 200 : 503 });
});
