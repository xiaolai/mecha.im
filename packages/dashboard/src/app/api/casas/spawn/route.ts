import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { casaName, MechaError } from "@mecha/core";
import type { SandboxMode } from "@mecha/core";
import { getProcessManager, log } from "@/lib/pm-singleton";

interface SpawnBody {
  name?: string;
  workspacePath?: string;
  port?: number;
  sandboxMode?: string;
  model?: string;
  permissionMode?: string;
  auth?: string | null;
  tags?: string[];
  expose?: string[];
  meterOff?: boolean;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    let body: SpawnBody;
    try {
      body = (await request.json()) as SpawnBody;
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    if (!body.name || !body.workspacePath) {
      return NextResponse.json(
        { error: "name and workspacePath are required" },
        { status: 400 },
      );
    }

    let validated;
    try {
      validated = casaName(body.name);
    } catch {
      return NextResponse.json({ error: `Invalid CASA name: ${body.name}` }, { status: 400 });
    }

    const pm = getProcessManager();
    const info = await pm.spawn({
      name: validated,
      workspacePath: body.workspacePath,
      port: body.port,
      sandboxMode: body.sandboxMode as SandboxMode | undefined,
      model: body.model,
      permissionMode: body.permissionMode,
      auth: body.auth,
      tags: body.tags,
      expose: body.expose,
      meterOff: body.meterOff,
    });

    const { token: _token, ...safe } = info as unknown as Record<string, unknown>;
    log.info("POST /api/casas/spawn", "CASA spawned", { name: validated });
    return NextResponse.json(safe, { status: 201 });
  } catch (err) {
    log.error("POST /api/casas/spawn", "Failed to spawn CASA", err);
    if (err instanceof MechaError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
