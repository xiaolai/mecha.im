import { NextResponse } from "next/server";
import { ContainerNotFoundError, MechaError } from "@mecha/core";
import { toHttpStatus, toSafeMessage } from "@mecha/contracts";

export function handleProcessError(err: unknown): NextResponse {
  if (err instanceof ContainerNotFoundError) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (err instanceof MechaError) {
    return NextResponse.json({ error: toSafeMessage(err) }, { status: toHttpStatus(err) });
  }
  throw err;
}
