import { NextResponse, type NextRequest } from "next/server";
import { mechaStatus, mechaConfigure, mechaRm } from "@mecha/service";
import { toHttpStatus, toSafeMessage } from "@mecha/contracts";
import { ContainerNotFoundError } from "@mecha/core";
import { getProcessManager } from "@/lib/process";
import { withAuth } from "@/lib/api-auth";

export const GET = withAuth(async (_request: NextRequest, { params }) => {
  const { id } = await params;
  const pm = getProcessManager();
  try {
    const status = await mechaStatus(pm, id);
    return NextResponse.json(status);
  } catch (err) {
    if (err instanceof ContainerNotFoundError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    throw err;
  }
});

export const PATCH = withAuth(async (request: NextRequest, { params }) => {
  const { id } = await params;
  const pm = getProcessManager();

  let body: { claudeToken?: string; anthropicApiKey?: string; otp?: string; permissionMode?: string };
  try {
    body = await request.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    await mechaConfigure(pm, {
      id,
      claudeToken: body.claudeToken,
      anthropicApiKey: body.anthropicApiKey,
      otp: body.otp,
      permissionMode: body.permissionMode as "default" | "plan" | "full-auto" | undefined,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ContainerNotFoundError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const status = toHttpStatus(err);
    return NextResponse.json({ error: toSafeMessage(err) }, { status });
  }
});

export const DELETE = withAuth(async (request: NextRequest, { params }) => {
  const { id } = await params;
  const withState = request.nextUrl.searchParams.get("withState") === "true";
  const pm = getProcessManager();
  try {
    await mechaRm(pm, { id, force: true, withState });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ContainerNotFoundError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    throw err;
  }
});
