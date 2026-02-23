import { NextResponse, type NextRequest } from "next/server";
import { mechaLs, mechaUp } from "@mecha/service";
import { toHttpStatus, toSafeMessage, MechaUpInput, BLOCKED_ENV_KEYS } from "@mecha/contracts";
import { getProcessManager } from "@/lib/process";
import { withAuth } from "@/lib/api-auth";
import { getOtpSecret } from "@/lib/auth";
import { aggregateMechas } from "@/lib/nodes";

export const GET = withAuth(async () => {
  const pm = getProcessManager();
  const items = await mechaLs(pm);
  const all = await aggregateMechas(items);

  // Map service response to dashboard-compatible shape (ports array for frontend)
  const mapped = all.map((item) => ({
    id: item.id,
    name: item.name,
    state: item.state,
    status: item.status,
    path: item.path,
    ports: item.port
      ? [{ PublicPort: item.port, PrivatePort: item.port, Type: "tcp" }]
      : [],
    created: item.created,
    node: item.node,
  }));
  return NextResponse.json(mapped);
});

/** Allowed env var key pattern (alphanumeric + underscore) */
const ALLOWED_ENV_KEY = /^[A-Z][A-Z0-9_]*$/;

function validateEnv(env: unknown): string[] | null {
  if (!env) return [];
  if (!Array.isArray(env)) return null;
  for (const entry of env) {
    if (typeof entry !== "string") return null;
    const eqIdx = entry.indexOf("=");
    if (eqIdx <= 0) return null;
    const key = entry.slice(0, eqIdx);
    if (!ALLOWED_ENV_KEY.test(key) || BLOCKED_ENV_KEYS.has(key)) return null;
  }
  return env as string[];
}

export const POST = withAuth(async (request: NextRequest) => {
  let body: { path?: string; env?: unknown; claudeToken?: string; otp?: string; permissionMode?: string };
  try {
    body = await request.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const projectPath = body.path;
  if (!projectPath || typeof projectPath !== "string") {
    return NextResponse.json({ error: "Missing path" }, { status: 400 });
  }

  // Validate env at API boundary before forwarding to service
  const env = validateEnv(body.env);
  if (env === null) {
    return NextResponse.json({ error: "Invalid env format or blocked key" }, { status: 400 });
  }

  // Validate input with Zod schema
  const parsed = MechaUpInput.safeParse({
    projectPath,
    claudeToken: body.claudeToken || process.env["CLAUDE_CODE_OAUTH_TOKEN"],
    otp: body.otp || getOtpSecret(),
    permissionMode: body.permissionMode,
    env,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Validation failed" }, { status: 400 });
  }

  const pm = getProcessManager();
  try {
    const result = await mechaUp(pm, parsed.data);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const status = toHttpStatus(err);
    return NextResponse.json({ error: toSafeMessage(err) }, { status });
  }
});
