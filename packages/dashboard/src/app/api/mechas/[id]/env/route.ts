import { NextResponse, type NextRequest } from "next/server";
import { mechaEnv } from "@mecha/service";
import { getProcessManager } from "@/lib/process";
import { withAuth } from "@/lib/api-auth";
import { handleProcessError } from "@/lib/process-errors";

const SENSITIVE_KEYS = new Set([
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "MECHA_OTP",
  "MECHA_AUTH_TOKEN",
]);

const SENSITIVE_PATTERN = /(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY|CREDENTIAL)/i;

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key) || SENSITIVE_PATTERN.test(key);
}

export const GET = withAuth(async (request: NextRequest, { params }) => {
  const { id } = await params;
  const showSecrets = request.nextUrl.searchParams.get("showSecrets") === "true";
  const pm = getProcessManager();
  try {
    const result = await mechaEnv(pm, id);
    const env = result.env.map((e) => ({
      key: e.key,
      value: !showSecrets && isSensitiveKey(e.key) ? "***" : e.value,
    }));
    return NextResponse.json({ id: result.id, env });
  } catch (err) {
    return handleProcessError(err);
  }
});
